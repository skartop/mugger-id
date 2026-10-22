import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childList } from '../src/ui.js';

test('childList flattens nested arrays and drops null, undefined and false', () => {
  const a = { tag: 'a' };
  const b = { tag: 'b' };
  assert.deepEqual(childList([null, [a, b], 'text', false, undefined, [[a]]]), [a, b, 'text', a]);
});

test('childList keeps 0 and empty strings', () => {
  assert.deepEqual(childList([0, '']), [0, '']);
});
