import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childList, memberName, estimateText } from '../src/ui.js';

test('childList flattens nested arrays and drops null, undefined and false', () => {
  const a = { tag: 'a' };
  const b = { tag: 'b' };
  assert.deepEqual(childList([null, [a, b], 'text', false, undefined, [[a]]]), [a, b, 'text', a]);
});

test('childList keeps 0 and empty strings', () => {
  assert.deepEqual(childList([0, '']), [0, '']);
});

test("memberName falls back to the attack's defender name, then to an id label", () => {
  const members = [{ id: 1, name: 'Alice' }];
  const attacks = [{ defender: { id: 2, name: 'Departed' } }, { defender: { id: 1, name: 'Alice' } }];
  assert.equal(memberName(1, members, attacks), 'Alice');
  assert.equal(memberName(2, members, attacks), 'Departed');
  assert.equal(memberName(9, members, attacks), 'Member [9]');
});

test('estimateText uses the fixed copy', () => {
  assert.ok(estimateText('mugs', { needed: 10, missing: 4, seconds: 3 })
    .startsWith("About 4 fight logs to fetch for mugs — under a minute at Torn's rate limit"));
  assert.equal(estimateText('mugs', { needed: 10, missing: 0, seconds: 0 }), 'Ready — no new logs needed.');
});
