// CSV export of every loaded attack, for analysis in a spreadsheet. Pure: no DOM, no network.
import { analyze, fingerprint } from './analyze.js?v=6';

export const CSV_COLUMNS = [
  'attack_id', 'code', 'started_utc', 'ended_utc', 'duration_s',
  'defender_id', 'defender_name', 'attacker_id', 'attacker_name', 'attacker_faction',
  'stealthed', 'result', 'respect_gain', 'respect_loss', 'fair_fight', 'overseas', 'chain',
  'weapons', 'hits', 'crits', 'damage_total', 'mug_amount', 'log_loaded',
  'top_suspect_id', 'top_suspect', 'confidence', 'ambiguous', 'group',
];

// Text a spreadsheet would run as a formula gets a leading apostrophe (names come from other players).
const FORMULA_START = /^[=+@\t\r]/;

export function csvField(value) {
  if (value == null) return '';
  let s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const utc = (ts) => (ts == null ? null : new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' '));
const yesNo = (b) => (b ? 'yes' : 'no');

// `opts` as for analyze(): { pooled, since }. Suspect columns come from scoring every stealthed attack type.
export function attacksToCsv(attacks, logs, opts = {}) {
  const { results } = analyze(attacks, logs, 'all', { pooled: opts.pooled ?? false, since: opts.since ?? null });
  const byId = new Map(results.map((r) => [r.mug.id, r]));
  const rows = [...attacks].sort((a, b) => b.started - a.started).map((a) => {
    const fp = fingerprint(a, logs.get(a.code));
    const scored = byId.get(a.id);
    const top = scored?.suspects[0];
    return [
      a.id, a.code, utc(a.started), utc(a.ended), a.ended != null && a.started != null ? a.ended - a.started : null,
      a.defender?.id, a.defender?.name, a.attacker?.id, a.attacker?.name, a.attacker?.faction?.name,
      yesNo(fp.stealthed), a.result, a.respect_gain, a.respect_loss, a.modifiers?.fair_fight, yesNo(fp.overseas), a.chain,
      fp.logMissing ? null : Object.keys(fp.weapons).join('; '),
      fp.logMissing ? null : fp.hits.length,
      fp.logMissing ? null : fp.hits.filter((h) => h.crit).length,
      fp.logMissing ? null : fp.hits.reduce((sum, h) => sum + h.damage, 0),
      fp.mugAmount, yesNo(!fp.logMissing),
      top?.candidate.id, top?.candidate.name, top?.confidence, scored ? yesNo(scored.ambiguous) : null, scored?.group,
    ];
  });
  return `﻿${[CSV_COLUMNS, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}

export const exportFilename = (mode, now = new Date()) => `mugger-id-${mode}-${now.toISOString().slice(0, 10)}.csv`;
