// Turns Torn attack-log entries into the attacker's side of the fight.
// Stealthed attackers appear as "Someone", but their weapons and damage stay in the text.

const WEAPON_RE = /\b(?:their|his|her) ([A-Z0-9].*?)(?: in the | hitting | missing |$)/;

export function classifyLine(text, { attackerName, defenderName }) {
  const t = text.toLowerCase();
  const startsWith = (name) => {
    if (!name) return false;
    const n = name.toLowerCase();
    return t === n || t.startsWith(`${n} `) || t.startsWith(`${n}'`);
  };
  if (startsWith(defenderName)) return 'defender';
  // Visible fight: only the named attacker's own lines count. "Someone" lines there belong to
  // stealthed joiners or to a different fight that ended up in the same log.
  if (attackerName) return startsWith(attackerName) ? 'attacker' : 'other';
  return t.startsWith('someone ') ? 'attacker' : 'other';
}

export function weaponOf(text) {
  if (text.includes(' kicked ')) return 'Kick';
  const thrown = /threw an? (.+?) (?:at|near) /.exec(text);
  if (thrown) return thrown[1];
  const m = WEAPON_RE.exec(text);
  return m ? m[1].replace(/ critically$/, '').trim() : null;
}

const toNumber = (s) => Number(s.replace(/,/g, ''));

export function parseLog(entries, names) {
  const weapons = {};
  const hits = [];
  let mugAmount = null;
  for (const e of entries) {
    if (classifyLine(e.text, names) !== 'attacker') continue;
    if (e.action === 'mug') {
      const m = /\$([\d,]+)/.exec(e.text);
      mugAmount = m ? toNumber(m[1]) : 0;
      continue;
    }
    const weapon = weaponOf(e.text);
    if (!weapon) continue;
    weapons[weapon] = (weapons[weapon] || 0) + 1;
    const dmg = / for ([\d,]+)$/.exec(e.text);
    if (dmg) {
      const part = / in the ([A-Za-z ]+?) for /.exec(e.text);
      hits.push({ weapon, damage: toNumber(dmg[1]), crit: e.text.includes('critically'), part: part ? part[1] : null });
    }
  }
  return { weapons, hits, mugAmount };
}
