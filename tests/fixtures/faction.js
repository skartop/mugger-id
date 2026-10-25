// Anonymized faction-scan scenarios: two members, placeholder names only (the repo is public).
import { attack, attacklog, player, MEMBER, T0, DAY } from './dataset.js';

export const MemberA = MEMBER; // 1001
export const MemberB = { id: 1002, name: 'MemberB' };
export { SuspectKnife } from './dataset.js';
export const OtherKnife = player(2101, 'OtherKnife', 'Faction O');

export const knifeLines = (n = 2) => [
  ...Array.from({ length: n }, () => ['hit', '{a} hit {d} with {p} Diamond Bladed Knife in the Chest for 160']),
  ['won', '{a} hit {d} with {p} Diamond Bladed Knife in the Stomach for 158'],
];

export function emptyDataset() {
  return { attacks: [], logs: new Map(), ids: {} };
}

// Adds an attack and its log to a dataset. `{p}` in lines = 'his' for visible attackers, 'their' for stealthed.
export function addAttack(ds, opts, lines, key = null) {
  const att = attack(opts);
  const pronoun = att.attacker ? 'his' : 'their';
  ds.attacks.push(att);
  ds.logs.set(att.code, attacklog(att, lines.map(([a, t]) => [a, t.replaceAll('{p}', pronoun)])));
  if (key) ds.ids[key] = att;
  return att;
}

// SuspectKnife openly hit MemberB with a knife (FF 2.00); an unseen knife user mugged MemberA (FF 3.00).
export function buildFactionDataset() {
  const ds = emptyDataset();
  const suspect = player(2001, 'SuspectKnife', 'Faction K');
  addAttack(ds, { attacker: suspect, at: T0 + DAY, result: 'Attacked', ff: 2, respect: 2, defender: MemberB }, knifeLines(), 'visibleB');
  addAttack(ds, { at: T0 + 2 * DAY, ff: 3, respect: 2.43, defender: MemberA }, [...knifeLines(), ['mug', 'Someone mugged {d} for $1,000 (+2.43)']], 'mugA');
  return ds;
}
