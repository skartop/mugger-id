import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, buildCandidates, weaponWeights, scoreCandidate, confidenceOf, analyze, logsNeeded } from '../src/analyze.js';
import { buildDataset, attack, attacklog, player, T0, DAY } from './fixtures/dataset.js';

function setup() {
  const { attacks, logs, ids } = buildDataset();
  const fps = attacks.map((a) => fingerprint(a, logs.get(a.code)));
  const candidates = buildCandidates(fps);
  const fp = (att) => fps.find((f) => f.id === att.id);
  const cand = (name) => candidates.find((c) => c.name === name);
  const score = (mugAtt, name) => {
    const mug = fp(mugAtt);
    return scoreCandidate(mug, cand(name), weaponWeights(mug, candidates));
  };
  return { ids, fps, candidates, fp, cand, score };
}

test('fingerprint marks stealth, overseas and parsed weapons', () => {
  const { ids, fp } = setup();
  const m = fp(ids.knifeMug1);
  assert.equal(m.stealthed, true);
  assert.equal(m.attacker, null);
  assert.equal(m.overseas, false);
  assert.deepEqual(m.weapons, { 'Diamond Bladed Knife': 4 }); // miss + 3 hits; defender's Minigun ignored
  assert.equal(m.mugAmount, 1315080);
  assert.equal(fp(ids.fistMug).overseas, true);
});

test('fingerprint without a log is flagged logMissing', () => {
  const { attacks } = buildDataset();
  const f = fingerprint(attacks[0], undefined);
  assert.equal(f.logMissing, true);
  assert.deepEqual(f.weapons, {});
});

test('buildCandidates groups visible fights per attacker', () => {
  const { candidates, cand } = setup();
  assert.equal(candidates.length, 6);
  assert.equal(cand('SuspectKnife').fights.length, 2);
  assert.equal(cand('SuspectKnife').weapons['Diamond Bladed Knife'], 5);
  assert.equal(cand('FactionlessA').faction, null);
});

test('weapon rarity only counts candidates active within 14 days; fists weigh 0', () => {
  const { ids, fp, candidates } = setup();
  const w = weaponWeights(fp(ids.knifeMug1), candidates);
  assert.equal(w['Diamond Bladed Knife'], 1); // KnifeOld used it too, but 44 days earlier
  assert.equal(w.Fists, 0);
  assert.equal(w.Kick, 0);
});

test('knife-only stealthed mugs near SuspectKnife visible hits rate High', () => {
  const { ids, score } = setup();
  for (const mug of [ids.knifeMug1, ids.knifeMug2]) {
    const r = score(mug, 'SuspectKnife');
    assert.equal(r.signals.weapon, 'strong');
    assert.equal(r.signals.ff, 'moderate'); // 3.00 = 3.00 but FF 3 is the cap, so downgraded
    assert.equal(r.signals.time, 'strong');
    assert.equal(r.confidence, 'High');
    assert.ok(r.reasons.some((x) => x.includes('Diamond Bladed Knife')));
    assert.ok(r.reasons.some((x) => x.includes('cap, weaker')));
  }
});

test('fist/kick-only overseas mug gets no weapon signal and is capped at Low', () => {
  const { ids, score } = setup();
  const r = score(ids.fistMug, 'TravelerTwo');
  assert.equal(r.signals.weapon, 'none');
  assert.equal(r.signals.ff, 'strong');
  assert.equal(r.signals.time, 'strong');
  assert.equal(r.confidence, 'Low');
});

test('factionless Macana mugs are not pinned on factionless muggers who never used a Macana', () => {
  const { ids, score } = setup();
  for (const mug of [ids.macanaMug1, ids.macanaMug2]) {
    for (const name of ['FactionlessA', 'FactionlessB']) {
      const r = score(mug, name);
      assert.equal(r.signals.weapon, 'against');
      assert.equal(r.confidence, null);
    }
  }
});

test('respect earned rules out a candidate who had no faction', () => {
  assert.equal(
    confidenceOf({ weapon: 'strong', ff: 'strong', time: 'strong', faction: 'strongAgainst', damage: false, overseas: false }, true),
    null,
  );
});

test('timing alone never makes a suspect', () => {
  assert.equal(
    confidenceOf({ weapon: 'none', ff: 'none', time: 'strong', faction: 'ok', damage: false, overseas: false }, true),
    null,
  );
});

test('fair-fight thresholds are inclusive despite floating-point error', () => {
  const fight = (ff) => ({ started: 0, ff, weapons: {}, hits: [], overseas: false, attacker: { id: 1, name: 'X', faction: 'F' } });
  const cand = (ff) => ({ id: 1, name: 'X', faction: 'F', lastSeen: 0, fights: [fight(ff)], weapons: {} });
  const mug = (ff) => ({ started: 0, ff, weapons: {}, hits: [], overseas: false, respect: 1 });
  assert.equal(scoreCandidate(mug(1.07), cand(1.1), {}).signals.ff, 'strong');
  assert.equal(scoreCandidate(mug(1.4), cand(1.5), {}).signals.ff, 'moderate');
});

test('analyze ranks suspects per stealthed mug, newest first', () => {
  const { attacks, logs, ids } = buildDataset();
  const r = analyze(attacks, logs);
  assert.equal(r.results.length, 5);
  assert.ok(r.results[0].mug.started >= r.results[1].mug.started);
  const knife = r.results.find((x) => x.mug.id === ids.knifeMug1.id);
  assert.equal(knife.suspects[0].candidate.name, 'SuspectKnife');
  assert.equal(knife.suspects[0].confidence, 'High');
  assert.ok(knife.suspects.length <= 3);
  const fist = r.results.find((x) => x.mug.id === ids.fistMug.id);
  assert.ok(fist.suspects.length > 0);
  assert.ok(fist.suspects.every((s) => s.confidence === 'Low'));
  const macana = r.results.find((x) => x.mug.id === ids.macanaMug1.id);
  assert.ok(!macana.suspects.some((s) => ['FactionlessA', 'FactionlessB'].includes(s.candidate.name)));
});

test('summary counts mugs, money and top-suspect confidence', () => {
  const { attacks, logs } = buildDataset();
  const { summary } = analyze(attacks, logs);
  assert.equal(summary.count, 5);
  assert.equal(summary.total, 1315080 + 261913 + 32 + 393 + 1071);
  assert.deepEqual(summary.byConfidence, { High: 2, Medium: 0, Low: 1, None: 2 });
});

test('leaderboard lists only Medium/High top suspects', () => {
  const { attacks, logs } = buildDataset();
  const { leaderboard } = analyze(attacks, logs);
  assert.deepEqual(leaderboard, [
    { id: 2001, name: 'SuspectKnife', faction: 'Faction K', hits: 2, total: 1315080 + 261913, best: 'High' },
  ]);
});

test('two equally good suspects make a mug ambiguous and nobody is credited', () => {
  const { attacks, logs } = buildDataset();
  const other = player(2007, 'OtherKnife', 'Faction O');
  const a = attack({ attacker: other, at: T0 + 6 * DAY, result: 'Attacked', ff: 3, respect: 3.24 });
  attacks.push(a);
  logs.set(a.code, attacklog(a, [['won', '{a} hit {d} with his Diamond Bladed Knife in the Chest for 170']]));
  const r = analyze(attacks, logs);
  const knife = r.results.filter((x) => x.mug.weapons['Diamond Bladed Knife']);
  assert.equal(knife.length, 2);
  assert.ok(knife.every((x) => x.ambiguous));
  assert.ok(!r.leaderboard.some((x) => x.name === 'SuspectKnife' || x.name === 'OtherKnife'));
  assert.equal(r.summary.ambiguous, 2);
});

test('unambiguous results are not flagged', () => {
  const { attacks, logs } = buildDataset();
  const r = analyze(attacks, logs);
  assert.ok(r.results.every((x) => x.ambiguous === false));
  assert.equal(r.summary.ambiguous, 0);
});

test('a candidate with no in-window fights does not inherit the in-window weapon weight', () => {
  const { ids, score } = setup();
  assert.equal(score(ids.knifeMug1, 'KnifeOld').signals.weapon, 'weak');
});

test('missing logs of in-window players stop a weapon looking unique', () => {
  const { attacks, logs, ids } = buildDataset();
  for (const [i, name] of [[2008, 'GapOne'], [2009, 'GapTwo']]) {
    attacks.push(attack({ attacker: player(i, name, 'Faction G'), at: T0 + 5 * DAY, result: 'Attacked', ff: 2, respect: 2 }));
  }
  const fps = attacks.map((a) => fingerprint(a, logs.get(a.code)));
  const candidates = buildCandidates(fps);
  const mug = fps.find((f) => f.id === ids.knifeMug1.id);
  const w = weaponWeights(mug, candidates);
  assert.ok(w['Diamond Bladed Knife'] < 1);
  const r = scoreCandidate(mug, candidates.find((c) => c.name === 'SuspectKnife'), w);
  assert.equal(r.signals.weapon, 'weak');
  assert.notEqual(r.confidence, 'High');
  const gap = scoreCandidate(mug, candidates.find((c) => c.name === 'GapOne'), w);
  assert.equal(gap.signals.weapon, 'none');
  assert.ok(gap.reasons.includes('no fight logs loaded for this player'));
});

test('a stealthed mug whose log is missing says so', () => {
  const { attacks, logs, ids } = buildDataset();
  logs.delete(ids.knifeMug1.code);
  const r = analyze(attacks, logs);
  const row = r.results.find((x) => x.mug.id === ids.knifeMug1.id);
  const s = scoreCandidate(row.mug, r.candidates.find((c) => c.name === 'SuspectKnife'), {});
  assert.ok(s.reasons.includes('fight log unavailable — weapons unknown'));
});

test('a log payload without a log array is treated as missing, not thrown on', () => {
  const { attacks } = buildDataset();
  const f = fingerprint(attacks[0], {});
  assert.equal(f.logMissing, true);
  assert.deepEqual(f.weapons, {});
});

// --- attack-type selector ---

function withStealthedHosp() {
  const { attacks, logs } = buildDataset();
  const hosp = attack({ at: T0 + 6 * DAY, result: 'Hospitalized', ff: 3, respect: 3.05 });
  attacks.push(hosp);
  logs.set(hosp.code, attacklog(hosp, [
    ['hit', 'Someone hit {d} with their Diamond Bladed Knife in the Chest for 165'],
    ['won', 'Someone critically hit {d} with their Diamond Bladed Knife in the Head for 610'],
    ['hosp', 'Someone hospitalized {d} (+3.05)'],
  ]));
  return { attacks, logs, hosp };
}

test('analyze defaults to stealthed mugs only', () => {
  const { attacks, logs } = withStealthedHosp();
  const r = analyze(attacks, logs);
  assert.equal(r.results.length, 5);
  assert.ok(r.results.every((x) => x.mug.result === 'Mugged'));
  assert.equal(r.summary.type, 'mugs');
});

test('hospitalizations type scores only stealthed hospitalizations, with no money', () => {
  const { attacks, logs, hosp } = withStealthedHosp();
  const r = analyze(attacks, logs, 'hosp');
  assert.deepEqual(r.results.map((x) => x.mug.id), [hosp.id]);
  assert.equal(r.results[0].suspects[0].candidate.name, 'SuspectKnife');
  assert.equal(r.results[0].suspects[0].confidence, 'High');
  assert.equal(r.summary.type, 'hosp');
  assert.equal(r.summary.total, 0);
  assert.deepEqual(r.leaderboard.map((x) => [x.name, x.hits, x.total]), [['SuspectKnife', 1, 0]]);
});

test('all type covers every stealthed attack and counts hits across types', () => {
  const { attacks, logs } = withStealthedHosp();
  const r = analyze(attacks, logs, 'all');
  assert.equal(r.results.length, 6);
  assert.equal(r.summary.total, 1315080 + 261913 + 32 + 393 + 1071);
  assert.deepEqual(r.leaderboard.map((x) => [x.name, x.hits]), [['SuspectKnife', 3]]);
});

test('left-on-the-street type matches the "Attacked" result', () => {
  const { attacks, logs } = buildDataset();
  const left = attack({ at: T0 + 3 * DAY, result: 'Attacked', ff: 1.5, respect: 1.2 });
  attacks.push(left);
  logs.set(left.code, attacklog(left, [['won', 'Someone hit {d} with their Sai in the Chest for 400']]));
  assert.deepEqual(analyze(attacks, logs, 'left').results.map((x) => x.mug.id), [left.id]);
});

test('logsNeeded asks for every visible attack plus the selected stealthed type', () => {
  const { attacks } = withStealthedHosp();
  const visible = attacks.filter((a) => a.attacker).length;
  assert.equal(logsNeeded(attacks, 'mugs').length, visible + 5);
  assert.equal(logsNeeded(attacks, 'hosp').length, visible + 1);
  assert.equal(logsNeeded(attacks, 'all').length, attacks.length);
});
