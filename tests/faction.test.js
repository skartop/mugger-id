import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, logsNeeded, scanEstimate, formatDuration } from '../src/analyze.js';
import { buildDataset, player, T0, DAY } from './fixtures/dataset.js';
import { MemberA, MemberB, OtherKnife, SuspectKnife, knifeLines, addAttack, emptyDataset, buildFactionDataset } from './fixtures/faction.js';

const mugLine = (n) => ['mug', `Someone mugged {d} for $${n} (+2.00)`];
const pooled = (ds, opts = {}) => analyze(ds.attacks, ds.logs, 'mugs', { pooled: true, ...opts });
const top = (r, att) => r.results.find((x) => x.mug.id === att.id).suspects[0];

test('cross-member knife evidence reaches Medium but not High', () => {
  const ds = buildFactionDataset();
  const s = top(pooled(ds), ds.ids.mugA);
  assert.equal(s.candidate.name, 'SuspectKnife');
  assert.equal(s.confidence, 'Medium');
  assert.equal(s.crossMember, true);
  assert.equal(s.signals.ff, 'none');
  assert.ok(s.reasons.includes('FF not comparable (different member)'));
  assert.ok(s.reasons.some((x) => x.includes('other member')));
});

test('fair fight from another member never counts, even when equal', () => {
  const ds = emptyDataset();
  addAttack(ds, { attacker: SuspectKnife, at: T0 + DAY, result: 'Attacked', ff: 3, respect: 2, defender: MemberB }, knifeLines());
  const mug = addAttack(ds, { at: T0 + 2 * DAY, ff: 3, respect: 2.43, defender: MemberA }, [...knifeLines(), mugLine(1000)]);
  assert.equal(top(pooled(ds), mug).signals.ff, 'none');
});

test('cross-member evidence with a common weapon stays Low', () => {
  const ds = buildFactionDataset();
  addAttack(ds, { attacker: OtherKnife, at: T0 + DAY, result: 'Attacked', ff: 1.5, respect: 1, defender: MemberB }, knifeLines());
  const r = pooled(ds);
  const s = r.results.find((x) => x.mug.id === ds.ids.mugA.id).suspects.find((x) => x.candidate.name === 'SuspectKnife');
  assert.equal(s.confidence, 'Low');
  assert.equal(s.crossMember, true);
  assert.ok(!r.leaderboard.some((x) => x.name === 'SuspectKnife'));
});

test('same-member fair fight still counts in pooled mode', () => {
  const ds = buildFactionDataset();
  addAttack(ds, { attacker: SuspectKnife, at: T0 + 3 * DAY, result: 'Attacked', ff: 3, respect: 2, defender: MemberA }, knifeLines());
  const s = top(pooled(ds), ds.ids.mugA);
  assert.equal(s.candidate.name, 'SuspectKnife');
  assert.equal(s.confidence, 'High');
  assert.equal(s.crossMember, false);
});

test('personal analysis is unchanged by pooling code', () => {
  const { attacks, logs } = buildDataset();
  const r = analyze(attacks, logs);
  assert.deepEqual(r.summary, { count: 5, total: 1578489, byConfidence: { High: 2, Medium: 0, Low: 1, None: 2 }, ambiguous: 0, type: 'mugs' });
  assert.deepEqual(r.leaderboard, [{ id: 2001, name: 'SuspectKnife', faction: 'Faction K', hits: 2, total: 1576993, best: 'High' }]);
  assert.ok(!r.results.some((x) => x.suspects.some((s) => s.crossMember === true)));
});

test('groups never cross members', () => {
  const five = (n) => [
    ['hit', '{a} fired 4 rounds of their Fiveseven hitting {d} in the Chest for 100'],
    ['won', '{a} fired 4 rounds of their Fiveseven hitting {d} in the Head for 120'],
    mugLine(n),
  ];
  const ds = emptyDataset();
  addAttack(ds, { at: T0 + 3600, ff: 2.52, respect: 2, defender: MemberA }, five(100));
  addAttack(ds, { at: T0 + 7200, ff: 2.53, respect: 2, defender: MemberB }, five(200));
  assert.equal(pooled(ds).groups.length, 0);
  // control: the same two hits on one member do group
  const same = emptyDataset();
  addAttack(same, { at: T0 + 3600, ff: 2.52, respect: 2, defender: MemberA }, five(100));
  addAttack(same, { at: T0 + 7200, ff: 2.53, respect: 2, defender: MemberA }, five(200));
  assert.equal(pooled(same).groups.length, 1);
});

test('leaderboard counts members hit', () => {
  const ds = buildFactionDataset();
  addAttack(ds, { at: T0 + 2 * DAY, ff: 2, respect: 2, defender: MemberB }, [...knifeLines(), mugLine(500)]);
  const r = pooled(ds);
  const row = r.leaderboard.find((x) => x.name === 'SuspectKnife');
  assert.equal(row.hits, 2);
  assert.equal(row.members, 2);
  assert.equal(r.summary.members, 2);
});

test('member view restricts results but keeps pooled suspects', () => {
  const ds = buildFactionDataset();
  addAttack(ds, { at: T0 + 2 * DAY, ff: 2, respect: 2, defender: MemberB }, [...knifeLines(), mugLine(500)]);
  const r = pooled(ds, { member: MemberA.id });
  assert.equal(r.results.length, 1);
  assert.ok(r.results.every((x) => x.mug.defender.id === 1001));
  assert.equal(r.results[0].suspects[0].candidate.name, 'SuspectKnife');
  assert.equal(r.summary.members, 1);
});

test('pooled logsNeeded selects visible attacks by attacker, not by date', () => {
  const ds = emptyDataset();
  addAttack(ds, { at: T0, ff: 2, respect: 2, defender: MemberA }, [...knifeLines(), mugLine(100)]);
  const mixedNear = addAttack(ds, { attacker: player(2202, 'MixedAttacker', 'Faction N'), at: T0 + 10 * DAY, result: 'Attacked', defender: MemberB }, knifeLines());
  const mixedFar = addAttack(ds, { attacker: player(2202, 'MixedAttacker', 'Faction N'), at: T0 + 20 * DAY, result: 'Attacked', defender: MemberB }, knifeLines());
  const farOnly = addAttack(ds, { attacker: player(2201, 'FarAttacker', 'Faction F'), at: T0 + 20 * DAY, result: 'Attacked', defender: MemberB }, knifeLines());
  const pooledIds = logsNeeded(ds.attacks, 'mugs', { pooled: true }).map((a) => a.id);
  assert.ok(pooledIds.includes(mixedNear.id));
  assert.ok(pooledIds.includes(mixedFar.id), 'a far fight of an attacker who also fought near a stealthed attack is kept');
  assert.ok(!pooledIds.includes(farOnly.id), 'an attacker whose only fight is far away is skipped');
  const plain = logsNeeded(ds.attacks, 'mugs').map((a) => a.id);
  assert.ok(plain.includes(farOnly.id) && plain.includes(mixedFar.id));
});

test('pooled analysis ignores stealthed attacks before the look-back', () => {
  const since = T0 + 30 * DAY;
  const ds = emptyDataset();
  const early = addAttack(ds, { at: since - 3 * DAY, ff: 2, respect: 2, defender: MemberA }, [...knifeLines(), mugLine(100)]);
  const late = addAttack(ds, { at: since + DAY, ff: 3, respect: 2, defender: MemberA }, [...knifeLines(), mugLine(200)]);
  const visible = addAttack(ds, { attacker: SuspectKnife, at: since - 3 * DAY, result: 'Attacked', ff: 2, respect: 2, defender: MemberB }, knifeLines());
  const r = pooled(ds, { since });
  assert.deepEqual(r.results.map((x) => x.mug.id), [late.id]);
  assert.equal(r.summary.count, 1);
  assert.equal(r.results[0].suspects[0].candidate.name, 'SuspectKnife', 'the pre-look-back visible fight still counts as evidence');
  const ids = logsNeeded(ds.attacks, 'mugs', { pooled: true, since }).map((a) => a.id);
  assert.ok(!ids.includes(early.id));
  assert.ok(ids.includes(late.id) && ids.includes(visible.id));
  assert.equal(pooled(ds).results.length, 2);
});

test('a same-member fight that proves nothing does not unlock cross-member Medium', () => {
  for (const sameFf of [2.4, null]) {
    const ds = emptyDataset();
    const M = T0 + 20 * DAY;
    const x = player(3001, 'SuspectX', 'Faction X');
    const z = player(3002, 'OtherZ', 'Faction Z');
    addAttack(ds, { attacker: x, at: M - 12 * DAY, result: 'Attacked', ff: sameFf, respect: 1, defender: MemberA }, [['hit', '{a} hit {d} with his Fists in the Chest for 150'], ['won', '{a} hit {d} with his Fists in the Stomach for 153']]);
    addAttack(ds, { attacker: x, at: M - DAY, result: 'Attacked', ff: 2, respect: 1, defender: MemberB }, knifeLines());
    addAttack(ds, { attacker: z, at: M - DAY, result: 'Attacked', ff: 2, respect: 1, defender: MemberB }, knifeLines());
    const mug = addAttack(ds, { at: M, ff: 2.6, respect: 2, defender: MemberA }, [...knifeLines(), mugLine(500)]);
    const r = pooled(ds);
    const s = r.results.find((q) => q.mug.id === mug.id).suspects.find((q) => q.candidate.name === 'SuspectX');
    assert.equal(s.confidence, 'Low', `ff ${sameFf}`);
    assert.ok(s.reasons.some((t) => /seen on 1 other member/.test(t)), s.reasons.join(' / '));
    assert.ok(!r.leaderboard.some((q) => q.name === 'SuspectX'));
  }
});

test('a common weapon seen on the same member keeps v1 Medium', () => {
  const ds = emptyDataset();
  const M = T0 + 20 * DAY;
  const x = player(3001, 'SuspectX', 'Faction X');
  const z = player(3002, 'OtherZ', 'Faction Z');
  addAttack(ds, { attacker: x, at: M - 5 * DAY, result: 'Attacked', ff: 2.4, respect: 1, defender: MemberA }, knifeLines());
  addAttack(ds, { attacker: z, at: M - 5 * DAY, result: 'Attacked', ff: 2, respect: 1, defender: MemberB }, knifeLines());
  const mug = addAttack(ds, { at: M, ff: 2.6, respect: 2, defender: MemberA }, [...knifeLines(), mugLine(500)]);
  const s = pooled(ds).results.find((q) => q.mug.id === mug.id).suspects.find((q) => q.candidate.name === 'SuspectX');
  assert.equal(s.signals.weapon, 'weak');
  assert.equal(s.confidence, 'Medium');
  assert.ok(s.reasons.some((t) => t.includes('used in 1 visible fight')));
});

test('null defender ids never count as the same member', () => {
  const ds = emptyDataset();
  const M = T0 + 20 * DAY;
  const nobody = { id: null, name: 'Nobody' };
  addAttack(ds, { attacker: SuspectKnife, at: M - DAY, result: 'Attacked', ff: 2.6, respect: 1, defender: nobody }, knifeLines());
  const mug = addAttack(ds, { at: M, ff: 2.6, respect: 2, defender: nobody }, [...knifeLines(), mugLine(500)]);
  const s = pooled(ds).results.find((q) => q.mug.id === mug.id).suspects[0];
  assert.equal(s.signals.ff, 'none');
  assert.equal(s.crossMember, true);
});

test('scanEstimate counts only uncached logs', () => {
  const needed = ['a', 'b', 'c', 'd', 'e'].map((code) => ({ code }));
  assert.deepEqual(scanEstimate(needed, new Set(['a', 'b'])), { needed: 5, missing: 3, seconds: 2.25 });
});

test('formatDuration reads in hours for large scans', () => {
  assert.equal(formatDuration(30), 'under a minute');
  assert.equal(formatDuration(61), 'about 2 min');
  assert.equal(formatDuration(4500), 'about 1 h 15 min');
  assert.equal(formatDuration(3550), 'about 1 h');
  assert.equal(formatDuration(3600), 'about 1 h');
  assert.equal(formatDuration(3660), 'about 1 h 1 min');
});
