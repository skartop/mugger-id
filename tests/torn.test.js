import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, TornError } from '../src/torn.js';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { json: async () => r };
  };
  fn.calls = calls;
  return fn;
}

function opts(fetchFn, extra = {}) {
  const sleeps = [];
  return { fetchFn, sleep: async (ms) => { sleeps.push(ms); }, minIntervalMs: 0, sleeps, ...extra };
}

test('sends the key in the Authorization header, never in the URL', async () => {
  const f = fakeFetch([{ info: { access: { level: 3, type: 'Limited Access' } } }]);
  const info = await createClient('ABCDEFGHIJKLMNOP', opts(f)).keyInfo();
  assert.deepEqual(info, { level: 3, type: 'Limited Access', faction: false });
  assert.equal(f.calls[0].url, 'https://api.torn.com/v2/key/info');
  assert.equal(f.calls[0].init.headers.Authorization, 'ApiKey ABCDEFGHIJKLMNOP');
  assert.ok(!f.calls[0].url.includes('ABCDEFGHIJKLMNOP'));
});

test('maps Torn error codes to friendly messages', async () => {
  const f = fakeFetch([{ error: { code: 2, error: 'Incorrect key' } }]);
  await assert.rejects(createClient('k', opts(f)).keyInfo(), (e) => e instanceof TornError && e.code === 2 && e.message === 'That API key is incorrect.');
});

test('waits 60 seconds and retries after a rate-limit error', async () => {
  const f = fakeFetch([{ error: { code: 5, error: 'Too many requests' } }, { info: { access: { level: 4, type: 'Full Access' } } }]);
  const o = opts(f);
  let warned = 0;
  o.onRateLimit = () => { warned += 1; };
  const info = await createClient('k', o).keyInfo();
  assert.equal(info.level, 4);
  assert.equal(warned, 1);
  assert.ok(o.sleeps.includes(60000));
});

test('retries network failures twice, then gives up with code -1', async () => {
  const f = fakeFetch([new Error('offline'), new Error('offline'), new Error('offline')]);
  await assert.rejects(createClient('k', opts(f)).keyInfo(), (e) => e instanceof TornError && e.code === -1);
  assert.equal(f.calls.length, 3);
});

test('pages incoming attacks back to the start of the window and de-duplicates', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, started: 1_999_900 - i }));
  const page2 = [{ id: 99, started: 1_999_801 }, { id: 100, started: 1_999_700 }, { id: 101, started: 999_000 }];
  const f = fakeFetch([{ attacks: page1 }, { attacks: page2 }]);
  const seen = [];
  const attacks = await createClient('k', opts(f, { now: () => 2_000_000_000 })).incomingAttacks(1_000_000, (n) => seen.push(n));
  assert.equal(attacks.length, 101); // id 101 is before the window
  assert.equal(attacks[0].started, 1_999_900);
  assert.ok(f.calls[0].url.endsWith('/user/attacks?filters=incoming&sort=DESC&limit=100&from=1000000&to=2000000'));
  assert.ok(f.calls[1].url.endsWith('&to=1999802'));
  assert.deepEqual(seen, [100, 101]);
});

test('stops paging when a full page adds nothing new', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ id: i, started: 1_500_000 }));
  const f = fakeFetch([{ attacks: page }, { attacks: page }, { attacks: page }]);
  const attacks = await createClient('k', opts(f, { now: () => 2_000_000_000 })).incomingAttacks(1_000_000);
  assert.equal(attacks.length, 100);
  assert.equal(f.calls.length, 2);
});

test('attackLog and profile unwrap their payloads', async () => {
  const f = fakeFetch([{ attacklog: { log: [], summary: [] } }, { profile: { id: 7, name: 'X' } }]);
  const c = createClient('k', opts(f));
  assert.deepEqual(await c.attackLog('ab cd'), { log: [], summary: [] });
  assert.ok(f.calls[0].url.endsWith('/torn/attacklog?log=ab%20cd'));
  assert.deepEqual(await c.profile(7), { id: 7, name: 'X' });
  assert.ok(f.calls[1].url.endsWith('/user/7/profile'));
});

test('attackLog returns null when the payload has no log array', async () => {
  const f = fakeFetch([{ attacklog: {} }]);
  assert.equal(await createClient('k', opts(f)).attackLog('x'), null);
});

test('retries Torn backend errors (code 17) twice, then gives up', async () => {
  const err = { error: { code: 17, error: 'Backend error' } };
  const ok = fakeFetch([err, err, { info: { access: { level: 3, type: 'Limited Access' } } }]);
  const o = opts(ok);
  assert.equal((await createClient('k', o).keyInfo()).level, 3);
  assert.deepEqual(o.sleeps, [2000, 4000]);
  const bad = fakeFetch([err, err, err]);
  await assert.rejects(createClient('k', opts(bad)).keyInfo(), (e) => e instanceof TornError && e.code === 17);
  assert.equal(bad.calls.length, 3);
});

test('keyInfo reports faction access', async () => {
  const yes = fakeFetch([{ info: { access: { level: 3, type: 'Limited Access', faction: true } } }]);
  assert.equal((await createClient('k', opts(yes)).keyInfo()).faction, true);
  const no = fakeFetch([{ info: { access: { level: 3, type: 'Limited Access' } } }]);
  assert.equal((await createClient('k', opts(no)).keyInfo()).faction, false);
});

test('factionAttacks pages the faction feed', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, started: 1_999_900 - i }));
  const page2 = [{ id: 99, started: 1_999_801 }, { id: 100, started: 1_999_700 }];
  const f = fakeFetch([{ attacks: page1 }, { attacks: page2 }]);
  const attacks = await createClient('k', opts(f, { now: () => 2_000_000_000 })).factionAttacks(1_000_000);
  assert.equal(attacks.length, 101);
  assert.equal(attacks[0].started, 1_999_900);
  assert.ok(f.calls[0].url.endsWith('/faction/attacks?filters=incoming&sort=DESC&limit=100&from=1000000&to=2000000'));
  assert.ok(f.calls[1].url.endsWith('&to=1999802'));
  assert.equal(f.calls.length, 2);
});

test('factionMembers maps id and name', async () => {
  const f = fakeFetch([{ members: [{ id: 1, name: 'A', level: 3 }] }]);
  assert.deepEqual(await createClient('k', opts(f)).factionMembers(), [{ id: 1, name: 'A' }]);
  assert.ok(f.calls[0].url.endsWith('/faction/members'));
});

test('factionMembers accepts an id-keyed object as well as an array', async () => {
  const f = fakeFetch([{ members: { 1: { id: 1, name: 'A' }, 2: { id: 2, name: 'B' } } }]);
  assert.deepEqual(await createClient('k', opts(f)).factionMembers(), [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
});
