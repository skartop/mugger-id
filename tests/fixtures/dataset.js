// Anonymized test data modelled on real fight patterns.
// No real players, factions or attack codes — the repo is public.

export const T0 = 1700000000;
export const DAY = 86400;
export const MEMBER = { id: 1001, name: 'MemberA' };

let seq = 0;

export function player(id, name, faction) {
  return { id, name, level: 50, faction: faction ? { id: id + 50000, name: faction } : null };
}

export function attack({ attacker = null, at, result = 'Mugged', ff = 1, overseas = 1, respect = 0 }) {
  seq += 1;
  return {
    id: 900000 + seq,
    code: `code${seq}`,
    started: at,
    ended: at + 5,
    attacker,
    defender: { id: MEMBER.id, name: MEMBER.name, level: 40, faction: { id: 1, name: 'Home Faction' } },
    result,
    respect_gain: respect,
    respect_loss: 0,
    chain: 0,
    is_interrupted: false,
    is_stealthed: attacker === null,
    modifiers: { fair_fight: ff, war: 1, retaliation: 1, group: 1, overseas, chain: 1, warlord: 1 },
  };
}

// lines: [action, text]; '{a}' = attacker display name ('Someone' when stealthed), '{d}' = 'membera'
// (lower case on purpose: real logs sometimes lower-case the defender's name).
export function attacklog(att, lines) {
  const a = att.attacker ? att.attacker.name : 'Someone';
  return {
    log: lines.map(([action, text], i) => ({
      action,
      text: text.replaceAll('{a}', a).replaceAll('{d}', 'membera'),
      timestamp: att.started + i,
      icon: '',
      attacker: null,
      defender: null,
    })),
    summary: [],
  };
}

export const SuspectKnife = player(2001, 'SuspectKnife', 'Faction K');
export const FactionlessA = player(2002, 'FactionlessA', null);
export const FactionlessB = player(2003, 'FactionlessB', null);
export const Traveler = player(2004, 'Traveler', 'Faction T');
export const KnifeOld = player(2005, 'KnifeOld', 'Faction Z');
export const TravelerTwo = player(2006, 'TravelerTwo', 'Faction U');

export function buildDataset() {
  seq = 0;
  const entries = [];
  const add = (att, lines) => {
    entries.push([att, attacklog(att, lines)]);
    return att;
  };

  // --- visible attackers (candidates) ---
  add(attack({ attacker: SuspectKnife, at: T0 + 5 * DAY, result: 'Attacked', ff: 3, respect: 3.24 }), [
    ['hit', '{a} hit {d} with his Diamond Bladed Knife in the Chest for 161'],
    ['hit', '{a} hit {d} with his Diamond Bladed Knife in the Stomach for 160'],
    ['hit', '{a} fired 4 rounds of his Jackhammer hitting {d} in the Left leg for 134'],
    ['won', '{a} hit {d} with his Diamond Bladed Knife in the Chest for 280'],
  ]);
  add(attack({ attacker: SuspectKnife, at: T0 + 7 * DAY, result: 'Mugged', ff: 3, respect: 2.43 }), [
    ['hit', '{a} hit {d} with his Diamond Bladed Knife in the Chest for 167'],
    ['won', '{a} hit {d} with his Diamond Bladed Knife in the Stomach for 158'],
    ['mug', '{a} mugged {d} for $2,644 (+2.43)'],
  ]);
  add(attack({ attacker: KnifeOld, at: T0 - 40 * DAY, result: 'Attacked', ff: 1.35, respect: 1.1 }), [
    ['won', '{a} hit {d} with his Diamond Bladed Knife in the Stomach for 300'],
  ]);
  add(attack({ attacker: FactionlessA, at: T0 - 30 * DAY, ff: 1, respect: 0 }), [
    ['won', '{a} hit {d} with his Kodachi in the Chest for 135'],
    ['mug', '{a} mugged {d} for $162,888'],
  ]);
  add(attack({ attacker: FactionlessB, at: T0 - 27 * DAY, ff: 1, respect: 0 }), [
    ['won', '{a} fired 3 rounds of his Enfield SA-80 hitting {d} in the Chest for 1000'],
    ['mug', '{a} mugged {d} for $79'],
  ]);
  add(attack({ attacker: Traveler, at: T0 + 1 * DAY, ff: 1.62, overseas: 1.25, respect: 1.64 }), [
    ['hit', '{a} hit {d} with his Fists in the Chest for 150'],
    ['won', '{a} hit {d} with his Fists in the Stomach for 153'],
    ['mug', '{a} mugged {d} for $1,681 (+1.64)'],
  ]);
  add(attack({ attacker: TravelerTwo, at: T0 + 2 * DAY - 3 * 3600, ff: 1.2, overseas: 1.25, respect: 1.2 }), [
    ['hit', '{a} kicked {d}  in the Stomach for 395'],
    ['won', '{a} kicked {d}  in the Chest for 717'],
    ['mug', '{a} mugged {d} for $1,459 (+1.20)'],
  ]);

  // --- stealthed mugs ---
  const knifeMug1 = add(attack({ at: T0 + 4 * DAY + 83220, ff: 3, respect: 2.43 }), [
    ['startfight', 'Someone initiated an attack against {d}'],
    ['missed', 'Someone missed {d} with their Diamond Bladed Knife'],
    ['missed', '{d} fired 21 rounds of his Minigun missing Someone'],
    ['hit', 'Someone hit {d} with their Diamond Bladed Knife in the Right foot for 170'],
    ['hit', 'Someone critically hit {d} with their Diamond Bladed Knife in the Head for 342'],
    ['won', 'Someone critically hit {d} with their Diamond Bladed Knife in the Head for 558'],
    ['mug', 'Someone mugged {d} for $1,315,080 (+2.43)'],
  ]);
  const knifeMug2 = add(attack({ at: T0 + 5 * DAY + 11880, ff: 3, respect: 2.43 }), [
    ['hit', 'Someone hit {d} with their Diamond Bladed Knife in the Chest for 212'],
    ['missed', '{d} fired 1 round of his SMAW Launcher missing Someone'],
    ['hit', 'Someone hit {d} with their Diamond Bladed Knife in the Left leg for 96'],
    ['won', 'Someone critically hit {d} with their Diamond Bladed Knife in the Throat for 594'],
    ['mug', 'Someone mugged {d} for $261,913 (+2.43)'],
  ]);
  const fistMug = add(attack({ at: T0 + 2 * DAY, ff: 1.21, overseas: 1.25, respect: 1.21 }), [
    ['won', 'Someone kicked {d}  in the Stomach for 542'],
    ['mug', 'Someone mugged {d} for $32 (+1.21)'],
  ]);
  const macanaMug1 = add(attack({ at: T0 - 29 * DAY, ff: 1, respect: 0 }), [
    ['won', 'Someone hit {d} with their Macana in the Chest for 1067'],
    ['mug', 'Someone mugged {d} for $393'],
  ]);
  const macanaMug2 = add(attack({ at: T0 - 28 * DAY, ff: 1, respect: 0 }), [
    ['won', 'Someone critically hit {d} with their Macana in the Head for 2697'],
    ['mug', 'Someone mugged {d} for $1,071'],
  ]);

  return {
    attacks: entries.map(([a]) => a),
    logs: new Map(entries.map(([a, l]) => [a.code, l])),
    ids: { knifeMug1, knifeMug2, fistMug, macanaMug1, macanaMug2 },
  };
}
