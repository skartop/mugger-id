import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_COLUMNS, csvField, attacksToCsv, exportFilename } from '../src/export.js';
import { buildDataset } from './fixtures/dataset.js';
import { buildFactionDataset } from './fixtures/faction.js';

// Minimal RFC 4180 reader for checking our own output.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const asRecords = (csv) => {
  const [head, ...body] = parseCsv(csv.replace(/^﻿/, ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

test('csvField quotes commas, quotes and newlines, and blanks null', () => {
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
  assert.equal(csvField(12.5), '12.5');
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
});

test('csvField defuses spreadsheet formulas in text', () => {
  assert.equal(csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvField('+cmd'), "'+cmd");
  assert.equal(csvField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvField(-3), '-3'); // numbers are left alone
});

test('export has a BOM, the fixed header, CRLF rows, one row per attack, newest first', () => {
  const { attacks, logs } = buildDataset();
  const csv = attacksToCsv(attacks, logs);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('\r\n'));
  const [head] = parseCsv(csv.slice(1));
  assert.deepEqual(head, CSV_COLUMNS);
  const rows = asRecords(csv);
  assert.equal(rows.length, attacks.length);
  const times = rows.map((r) => r.started_utc);
  assert.deepEqual(times, [...times].sort().reverse());
});

test('a stealthed mug row carries exact times, parsed weapons, money and the top suspect', () => {
  const { attacks, logs, ids } = buildDataset();
  const row = asRecords(attacksToCsv(attacks, logs)).find((r) => r.attack_id === String(ids.knifeMug1.id));
  assert.equal(row.started_utc, new Date(ids.knifeMug1.started * 1000).toISOString().slice(0, 19).replace('T', ' '));
  assert.equal(row.duration_s, '5');
  assert.equal(row.stealthed, 'yes');
  assert.equal(row.attacker_name, '');
  assert.equal(row.result, 'Mugged');
  assert.equal(row.fair_fight, '3');
  assert.equal(row.weapons, 'Diamond Bladed Knife');
  assert.equal(row.hits, '3');
  assert.equal(row.crits, '2');
  assert.equal(row.mug_amount, '1315080');
  assert.equal(row.log_loaded, 'yes');
  assert.equal(row.top_suspect, 'SuspectKnife');
  assert.equal(row.top_suspect_id, '2001');
  assert.equal(row.confidence, 'High');
  assert.equal(row.group, 'Unknown attacker A');
});

test('a visible attack row names the attacker and leaves suspect columns empty', () => {
  const { attacks, logs } = buildDataset();
  const row = asRecords(attacksToCsv(attacks, logs)).find((r) => r.attacker_name === 'SuspectKnife');
  assert.equal(row.stealthed, 'no');
  assert.equal(row.attacker_id, '2001');
  assert.equal(row.attacker_faction, 'Faction K');
  assert.equal(row.top_suspect, '');
  assert.equal(row.confidence, '');
});

test('an attack whose log never loaded says so', () => {
  const { attacks, logs, ids } = buildDataset();
  logs.delete(ids.macanaMug1.code);
  const row = asRecords(attacksToCsv(attacks, logs)).find((r) => r.attack_id === String(ids.macanaMug1.id));
  assert.equal(row.log_loaded, 'no');
  assert.equal(row.weapons, '');
  assert.equal(row.mug_amount, '');
});

test('pooled export scores across members and names each defender', () => {
  const { attacks, logs, ids } = buildFactionDataset();
  const rows = asRecords(attacksToCsv(attacks, logs, { pooled: true }));
  const mug = rows.find((r) => r.attack_id === String(ids.mugA.id));
  assert.equal(mug.defender_name, 'MemberA');
  assert.equal(mug.top_suspect, 'SuspectKnife');
  assert.equal(mug.confidence, 'Medium');
  assert.equal(rows.find((r) => r.attack_id === String(ids.visibleB.id)).defender_name, 'MemberB');
});

test('exportFilename names the mode and the date', () => {
  assert.equal(exportFilename('personal', new Date(Date.UTC(2026, 9, 26, 12))), 'mugger-id-personal-2026-10-26.csv');
  assert.equal(exportFilename('faction', new Date(Date.UTC(2026, 9, 26, 12))), 'mugger-id-faction-2026-10-26.csv');
});
