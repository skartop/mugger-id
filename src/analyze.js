// Fingerprints fights and scores visible attackers as suspects for stealthed mugs.
// Pure functions: no network, no DOM.
import { parseLog } from './parse.js';

export const DAY = 86400;
const WINDOW = 14 * DAY;
const FIST_WEAPONS = new Set(['Fists', 'Kick']);
export const RANK = { High: 3, Medium: 2, Low: 1 };

export function fingerprint(attack, attacklog) {
  const names = { attackerName: attack.attacker?.name ?? null, defenderName: attack.defender?.name ?? null };
  const usable = Array.isArray(attacklog?.log);
  const parsed = usable ? parseLog(attacklog.log, names) : { weapons: {}, hits: [], mugAmount: null };
  return {
    id: attack.id,
    code: attack.code,
    started: attack.started,
    result: attack.result,
    stealthed: attack.attacker == null,
    attacker: attack.attacker
      ? { id: attack.attacker.id, name: attack.attacker.name, faction: attack.attacker.faction?.name ?? null }
      : null,
    ff: attack.modifiers?.fair_fight ?? null,
    overseas: (attack.modifiers?.overseas ?? 1) > 1,
    respect: attack.respect_gain ?? 0,
    weapons: parsed.weapons,
    hits: parsed.hits,
    mugAmount: parsed.mugAmount,
    logMissing: !usable,
  };
}

export function buildCandidates(fps) {
  const byId = new Map();
  for (const fp of fps) {
    if (fp.stealthed) continue;
    let c = byId.get(fp.attacker.id);
    if (!c) {
      c = { id: fp.attacker.id, name: fp.attacker.name, faction: fp.attacker.faction, lastSeen: 0, fights: [], weapons: {} };
      byId.set(c.id, c);
    }
    c.fights.push(fp);
    if (fp.started >= c.lastSeen) {
      c.lastSeen = fp.started;
      c.faction = fp.attacker.faction;
    }
    for (const [w, n] of Object.entries(fp.weapons)) c.weapons[w] = (c.weapons[w] || 0) + n;
  }
  return [...byId.values()];
}

const realWeapons = (fp) => Object.keys(fp.weapons).filter((w) => !FIST_WEAPONS.has(w));
const gapTo = (mug) => (f) => Math.abs(f.started - mug.started);

// How many candidates active around the time of this mug used each weapon. Rarer = more telling.
export function weaponWeights(mug, candidates) {
  const users = {};
  const unknown = []; // in-window players whose fight logs are missing: they may have used anything
  for (const c of candidates) {
    if (!c.fights.some((f) => gapTo(mug)(f) <= WINDOW)) continue;
    for (const w of Object.keys(c.weapons)) users[w] = (users[w] || 0) + 1;
    if (c.fights.some((f) => f.logMissing)) unknown.push(c);
  }
  const weights = {};
  for (const w of new Set([...Object.keys(users), ...realWeapons(mug)])) {
    const n = (users[w] || 0) + unknown.filter((c) => !c.weapons[w]).length;
    weights[w] = FIST_WEAPONS.has(w) || !n ? 0 : 1 / n;
  }
  return weights;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const nonCrit = (hits, weapon) => hits.filter((h) => h.weapon === weapon && !h.crit && h.damage > 0).map((h) => h.damage);

function describeGap(sec) {
  const d = Math.round(sec / DAY);
  return d === 0 ? 'same day' : `${d} day${d === 1 ? '' : 's'} away`;
}

export function confidenceOf(s, hasWeapon) {
  if (s.faction === 'strongAgainst') return null;
  const weaponMatch = s.weapon === 'strong' || s.weapon === 'weak';
  const ffMatch = s.ff === 'strong' || s.ff === 'moderate';
  const timeOk = s.time !== 'none';
  const negatives = (s.weapon === 'against') + (s.ff === 'against') + (s.faction === 'weakAgainst');
  let level = null;
  if (s.weapon === 'strong' && ffMatch && s.time === 'strong' && negatives === 0) level = 'High';
  else if ([weaponMatch, ffMatch, timeOk].filter(Boolean).length >= 2 && negatives === 0) level = 'Medium';
  else if ((weaponMatch || ffMatch) && s.weapon !== 'against') level = 'Low';
  if (!hasWeapon && level) level = 'Low'; // fists/kicks only: too easy to match by coincidence
  return level;
}

function scoreOf(s) {
  const pts = { strong: 2, moderate: 1, weak: 1 };
  return (pts[s.weapon] || 0) + (pts[s.ff] || 0) + (pts[s.time] || 0) + (s.damage ? 1 : 0) + (s.overseas ? 1 : 0);
}

export function scoreCandidate(mug, cand, weights) {
  const reasons = [];
  const signals = { weapon: 'none', ff: 'none', time: 'none', faction: 'ok', damage: false, overseas: false };
  const gap = gapTo(mug);

  const sWeapons = realWeapons(mug);
  if (mug.logMissing) reasons.push('fight log unavailable — weapons unknown');
  const inWindow = cand.fights.some((f) => gap(f) <= WINDOW);
  // A player with no in-window fights was not counted in the weights, so assume one more user.
  const eff = (w) => {
    const x = weights[w] ?? 0;
    return inWindow || x === 0 ? x : 1 / (1 / x + 1);
  };
  if (sWeapons.length) {
    const shared = sWeapons.filter((w) => cand.weapons[w]);
    if (shared.length) {
      const best = shared.reduce((a, b) => (eff(b) > eff(a) ? b : a));
      signals.weapon = eff(best) >= 1 ? 'strong' : 'weak';
      const n = cand.fights.filter((f) => f.weapons[best]).length;
      reasons.push(`${best} used in ${n} visible fight${n === 1 ? '' : 's'}${signals.weapon === 'weak' ? ' (common weapon)' : ''}`);
    } else if (cand.fights.every((f) => f.logMissing)) {
      reasons.push('no fight logs loaded for this player');
    } else {
      signals.weapon = 'against';
      reasons.push(`never seen using ${sWeapons.join(', ')}`);
    }
  }

  const near = cand.fights.filter((f) => f.ff != null && gap(f) <= WINDOW);
  if (mug.ff != null && near.length) {
    const closest = near.reduce((a, b) => (Math.abs(b.ff - mug.ff) < Math.abs(a.ff - mug.ff) ? b : a));
    const diff = Math.round(Math.abs(closest.ff - mug.ff) * 100) / 100;
    let level = diff <= 0.03 ? 'strong' : diff <= 0.1 ? 'moderate' : diff > 0.3 ? 'against' : 'none';
    const edge = mug.ff === 3 || mug.ff === 1;
    if (edge && level === 'strong') level = 'moderate';
    else if (edge && level === 'moderate') level = 'none';
    signals.ff = level;
    if (level !== 'none') {
      const note = edge ? (mug.ff === 3 ? ' (cap, weaker)' : ' (floor, weaker)') : '';
      reasons.push(`FF ${mug.ff.toFixed(2)} vs ${closest.ff.toFixed(2)}${note}${level === 'against' ? ' — too far apart' : ''}`);
    }
  }

  const minGap = Math.min(...cand.fights.map(gap));
  if (minGap <= 3 * DAY) signals.time = 'strong';
  else if (minGap <= WINDOW) signals.time = 'moderate';
  if (signals.time !== 'none') reasons.push(`visible hit ${describeGap(minGap)}`);

  const nearest = cand.fights.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  const candInFaction = nearest.attacker.faction != null;
  if (mug.respect > 0 && !candInFaction) {
    signals.faction = 'strongAgainst';
    reasons.push('stealthed attacker earned respect but this player had no faction');
  } else if (mug.respect === 0 && candInFaction) {
    signals.faction = 'weakAgainst';
    reasons.push('no respect earned but this player was in a faction');
  }

  for (const w of sWeapons) {
    const a = nonCrit(mug.hits, w);
    const b = cand.fights.flatMap((f) => nonCrit(f.hits, w));
    if (a.length && b.length) {
      const ma = median(a);
      const mb = median(b);
      if (Math.abs(ma - mb) <= 0.35 * mb) {
        signals.damage = true;
        reasons.push(`${w} damage similar (~${Math.round(ma)} vs ~${Math.round(mb)})`);
        break;
      }
    }
  }

  if (mug.overseas && cand.fights.some((f) => f.overseas && gap(f) <= 3 * DAY)) {
    signals.overseas = true;
    reasons.push('also attacking abroad around then');
  }

  return { signals, confidence: confidenceOf(signals, sWeapons.length > 0), score: scoreOf(signals), reasons };
}

function summarize(results) {
  const byConfidence = { High: 0, Medium: 0, Low: 0, None: 0 };
  let total = 0;
  for (const r of results) {
    total += r.mug.mugAmount ?? 0;
    byConfidence[r.suspects[0]?.confidence ?? 'None'] += 1;
  }
  return { count: results.length, total, byConfidence, ambiguous: results.filter((r) => r.ambiguous).length };
}

function buildLeaderboard(results) {
  const rows = new Map();
  for (const { mug, suspects, ambiguous } of results) {
    const top = suspects[0];
    if (!top || ambiguous || top.confidence === 'Low') continue;
    const row = rows.get(top.candidate.id) ?? { ...top.candidate, hits: 0, total: 0, best: top.confidence };
    row.hits += 1;
    row.total += mug.mugAmount ?? 0;
    if (RANK[top.confidence] > RANK[row.best]) row.best = top.confidence;
    rows.set(top.candidate.id, row);
  }
  return [...rows.values()].sort((a, b) => RANK[b.best] - RANK[a.best] || b.hits - a.hits || b.total - a.total);
}

// Which stealthed attacks each selector choice covers. `results: null` means every stealthed attack.
export const ATTACK_TYPES = {
  mugs: { label: 'Mugs', one: 'mug', many: 'mugs', results: ['Mugged'] },
  hosp: { label: 'Hospitalizations', one: 'hospitalization', many: 'hospitalizations', results: ['Hospitalized'] },
  left: { label: 'Left on the street', one: 'attack (left on the street)', many: 'attacks (left on the street)', results: ['Attacked'] },
  all: { label: 'All stealthed', one: 'attack', many: 'attacks', results: null },
};

const ofType = (type) => {
  const allowed = ATTACK_TYPES[type].results;
  return (result) => allowed === null || allowed.includes(result);
};

// Logs to fetch for a type: every visible attack (the candidates) plus the stealthed attacks of that type.
export function logsNeeded(attacks, type) {
  const wanted = ofType(type);
  return attacks.filter((a) => a.attacker || wanted(a.result));
}

// Each result's `mug` is the stealthed attack being explained — a mug unless another type is selected.
export function analyze(attacks, logs, type = 'mugs') {
  const fingerprints = attacks.map((a) => fingerprint(a, logs.get(a.code)));
  const candidates = buildCandidates(fingerprints);
  const wanted = ofType(type);
  const stealthed = fingerprints.filter((f) => f.stealthed && wanted(f.result)).sort((a, b) => b.started - a.started);
  const results = stealthed.map((mug) => {
    const weights = weaponWeights(mug, candidates);
    const suspects = candidates
      .map((c) => ({ candidate: { id: c.id, name: c.name, faction: c.faction }, ...scoreCandidate(mug, c, weights) }))
      .filter((s) => s.confidence)
      .sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.score - a.score)
      .slice(0, 3);
    const ambiguous = suspects.length > 1 && suspects[0].confidence !== 'Low' && suspects[0].confidence === suspects[1].confidence;
    return { mug, suspects, ambiguous };
  });
  return { results, candidates, fingerprints, summary: { ...summarize(results), type }, leaderboard: buildLeaderboard(results) };
}
