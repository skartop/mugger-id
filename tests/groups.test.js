import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, groupAttacks } from '../src/analyze.js';
import { buildDataset, T0, DAY } from './fixtures/dataset.js';

// Synthetic analysed results: just the fields grouping looks at.
let seq = 0;
function result({ weapons = { Fiveseven: 2 }, ff = 2.5, at = T0, respect = 2, top = null, ambiguous = false, logMissing = false }) {
  seq += 1;
  return {
    mug: { id: seq, code: `g${seq}`, started: at, result: 'Mugged', weapons, ff, respect, logMissing, hits: [] },
    suspects: top ? [{ candidate: { id: top.id, name: top.name, faction: 'F' }, confidence: top.confidence }] : [],
    ambiguous,
  };
}
const newestFirst = (rs) => rs.sort((a, b) => b.mug.started - a.mug.started);

test('two stealthed hits with the same weapon and fair fight form one unknown attacker', () => {
  const groups = groupAttacks(newestFirst([result({ ff: 2.53, at: T0 + 3600 }), result({ ff: 2.52, at: T0 + 2 * 3600 })]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'Unknown attacker A');
  assert.equal(groups[0].members.length, 2);
  assert.deepEqual(groups[0].weapons, ['Fiveseven']);
  assert.deepEqual([groups[0].ffMin, groups[0].ffMax], [2.52, 2.53]);
  assert.equal(groups[0].identity, null);
});

test('fist and kick only hits never group', () => {
  assert.deepEqual(groupAttacks(newestFirst([result({ weapons: { Fists: 3 } }), result({ weapons: { Kick: 1, Fists: 1 } })])), []);
});

test('hits are kept apart when fair fight, timing, respect or a missing log disagree', () => {
  const far = groupAttacks(newestFirst([result({ ff: 2.53 }), result({ ff: 1.9 })]));
  const late = groupAttacks(newestFirst([result({ at: T0 }), result({ at: T0 + 20 * DAY })]));
  const resp = groupAttacks(newestFirst([result({ respect: 2 }), result({ respect: 0 })]));
  const nolog = groupAttacks(newestFirst([result({}), result({ logMissing: true, weapons: {} })]));
  assert.deepEqual([far.length, late.length, resp.length, nolog.length], [0, 0, 0, 0]);
});

test('every pair in a group must match, so a chain of near-misses is split', () => {
  const rs = newestFirst([result({ ff: 2.0, at: T0 + 3 * 3600 }), result({ ff: 2.04, at: T0 + 2 * 3600 }), result({ ff: 2.08, at: T0 + 3600 })]);
  const groups = groupAttacks(rs);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.map((m) => m.mug.ff), [2.0, 2.04]);
});

test('a group notes a possible identity from direct matches without claiming the rest', () => {
  const x = { id: 7, name: 'SuspectX', confidence: 'High' };
  const groups = groupAttacks(newestFirst([result({ at: T0 + 3600, top: x }), result({ at: T0 + 7200 }), result({ at: T0 + 9000, top: { ...x, confidence: 'Low' } })]));
  assert.deepEqual(groups[0].identity, { kind: 'possible', id: 7, name: 'SuspectX', matched: 1, total: 3 });
});

test('ambiguous direct matches do not name a group', () => {
  const x = { id: 7, name: 'SuspectX', confidence: 'High' };
  const groups = groupAttacks(newestFirst([result({ at: T0 + 3600, top: x, ambiguous: true }), result({ at: T0 + 7200 })]));
  assert.equal(groups[0].identity, null);
});

test('direct matches to different players are reported as conflicting', () => {
  const groups = groupAttacks(newestFirst([
    result({ at: T0 + 3600, top: { id: 7, name: 'SuspectX', confidence: 'High' } }),
    result({ at: T0 + 7200, top: { id: 8, name: 'SuspectY', confidence: 'Medium' } }),
  ]));
  assert.deepEqual(groups[0].identity, { kind: 'conflict', names: ['SuspectX', 'SuspectY'] });
});

test('groups at the fair-fight cap or floor are flagged as weaker', () => {
  const groups = groupAttacks(newestFirst([result({ ff: 3, at: T0 + 3600 }), result({ ff: 3, at: T0 + 7200 })]));
  assert.equal(groups[0].edge, true);
});

test('analyze groups the fixture knife mugs, links them to their direct match, and tags each result', () => {
  const { attacks, logs, ids } = buildDataset();
  const r = analyze(attacks, logs);
  const knife = r.groups.find((g) => g.members.some((m) => m.mug.id === ids.knifeMug1.id));
  assert.ok(knife, 'knife mugs should form a group');
  assert.deepEqual(knife.members.map((m) => m.mug.id).sort(), [ids.knifeMug1.id, ids.knifeMug2.id].sort());
  assert.deepEqual(knife.identity, { kind: 'possible', id: 2001, name: 'SuspectKnife', matched: 2, total: 2 });
  const macana = r.groups.find((g) => g.members.some((m) => m.mug.id === ids.macanaMug1.id));
  assert.equal(macana.identity, null);
  assert.equal(r.results.find((x) => x.mug.id === ids.knifeMug1.id).group, knife.label);
  assert.equal(r.results.find((x) => x.mug.id === ids.fistMug.id).group, undefined);
});
