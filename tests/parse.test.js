import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog, weaponOf, classifyLine } from '../src/parse.js';

const names = { attackerName: null, defenderName: 'MemberA' };

test('weaponOf reads melee, firearm and kick lines', () => {
  assert.equal(weaponOf('Someone hit membera with their Diamond Bladed Knife in the Groin for 1246'), 'Diamond Bladed Knife');
  assert.equal(weaponOf('Someone fired 3 HP rounds of their Ithaca 37 hitting membera in the Groin for 1087'), 'Ithaca 37');
  assert.equal(weaponOf('Someone fired 2 rounds of their Blunderbuss critically hitting membera in the Head for 900'), 'Blunderbuss');
  assert.equal(weaponOf('Someone missed membera with their Macana'), 'Macana');
  assert.equal(weaponOf('Someone critically kicked membera  in the Head for 2167'), 'Kick');
  assert.equal(weaponOf('Someone hospitalized membera (+3.05)'), null);
  assert.equal(weaponOf('Someone threw a Grenade at membera, it exploded for 646'), 'Grenade');
  assert.equal(weaponOf('SuspectKnife threw a Flash Grenade near membera'), 'Flash Grenade');
  assert.equal(weaponOf('Someone fired 6 rounds of their 9mm Uzi hitting membera in the Chest for 412'), '9mm Uzi');
  assert.equal(weaponOf('Someone missed membera with their 9mm Uzi'), '9mm Uzi');
});

test('classifyLine matches the defender case-insensitively', () => {
  assert.equal(classifyLine('membera fired 21 rounds of his Minigun missing Someone', names), 'defender');
  assert.equal(classifyLine('Someone hit membera with their Sai in the Chest for 450', names), 'attacker');
  assert.equal(
    classifyLine('SuspectKnife hit membera with his Sai in the Chest for 450', { attackerName: 'SuspectKnife', defenderName: 'MemberA' }),
    'attacker',
  );
  assert.equal(classifyLine('Someone initiated an attack against membera', names), 'attacker');
});

test('in a visible fight, "Someone" lines are not credited to the named attacker', () => {
  const visible = { attackerName: 'SuspectKnife', defenderName: 'MemberA' };
  assert.equal(classifyLine('Someone hit membera with her Macana in the Left foot for 193', visible), 'other');
  assert.equal(classifyLine('Someone missed SuspectKnife with her Yasukuni Sword', visible), 'other');
  const r = parseLog([
    { action: 'hit', text: 'SuspectKnife hit membera with his Diamond Bladed Knife in the Chest for 161' },
    { action: 'hit', text: 'Someone hit membera with her Macana in the Left foot for 193' },
  ], visible);
  assert.deepEqual(r.weapons, { 'Diamond Bladed Knife': 1 });
});

test('parseLog keeps only attacker-side weapons, hits and the mug amount', () => {
  const entries = [
    { action: 'startfight', text: 'Someone initiated an attack against membera' },
    { action: 'missed', text: 'Someone missed membera with their Diamond Bladed Knife' },
    { action: 'missed', text: 'membera fired 21 rounds of his Minigun missing Someone' },
    { action: 'hit', text: 'Someone critically hit membera with their Diamond Bladed Knife in the Head for 342' },
    { action: 'missed', text: 'membera fired 1 round of his SMAW Launcher missing Someone' },
    { action: 'won', text: 'Someone hit membera with their Diamond Bladed Knife in the Chest for 1,058' },
    { action: 'mug', text: 'Someone mugged membera for $1,315,080 (+2.43)' },
  ];
  const r = parseLog(entries, names);
  assert.deepEqual(r.weapons, { 'Diamond Bladed Knife': 3 });
  assert.deepEqual(r.hits, [
    { weapon: 'Diamond Bladed Knife', damage: 342, crit: true, part: 'Head' },
    { weapon: 'Diamond Bladed Knife', damage: 1058, crit: false, part: 'Chest' },
  ]);
  assert.equal(r.mugAmount, 1315080);
});
