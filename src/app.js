import { createClient, TornError } from './torn.js';
import { openCache } from './cache.js';
import { analyze } from './analyze.js';
import { renderSummary, renderLeaderboard, renderMugList, renderDrilldown } from './ui.js';

const KEY_STORE = 'mugger-id:key';
const $ = (id) => document.getElementById(id);
const storedKey = {
  get() { try { return localStorage.getItem(KEY_STORE); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY_STORE, v); } catch { /* storage blocked */ } },
  clear() { try { localStorage.removeItem(KEY_STORE); } catch { /* storage blocked */ } },
};

const FATAL = new Set([2, 5, 8, 9, 10, 13, 16, 18]); // errors where continuing cannot help
let cancelled = false;
let state = null; // { client, attacks, logs, result }
const profiles = new Map();

function setError(message) {
  $('error').textContent = message ?? '';
  $('error').hidden = !message;
}

function setProgress(label, done = 0, total = 0) {
  $('progress-label').textContent = label;
  if (total) {
    $('progress').max = total;
    $('progress').value = done;
  } else {
    $('progress').removeAttribute('value'); // indeterminate
  }
}

function render() {
  if (!state) return;
  state.result = analyze(state.attacks, state.logs);
  $('results').hidden = false;
  renderSummary($('summary'), state.result);
  renderLeaderboard($('leaderboard'), state.result);
  renderMugList($('mugs'), state.result, { onlyStrong: $('only-strong').checked, onSelect: openDrill });
}

function setPartial(logs, wanted) {
  const missing = logs.size < wanted;
  $('partial').hidden = !missing;
  $('partial').textContent = missing
    ? `Partial results — ${logs.size} of ${wanted} fight logs loaded. Confidence may be overstated; run Analyze again to finish.`
    : '';
}

function loadProfile(id) {
  if (!profiles.has(id)) {
    profiles.set(id, state.client.profile(id).catch((e) => { profiles.delete(id); throw e; }));
  }
  return profiles.get(id);
}

function openDrill(row) {
  const el = $('drill');
  el.hidden = false;
  renderDrilldown(el, row, {
    logFor: (code) => state.logs.get(code),
    fingerprints: state.result.fingerprints,
    loadProfile,
    onClose: () => { el.hidden = true; },
  });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function run(key, days) {
  cancelled = false;
  setError(null);
  $('cleared').hidden = true;
  $('drill').hidden = true;
  $('partial').hidden = true;
  $('working').hidden = false;
  $('analyze').disabled = true;
  let wantedCount = 0;
  const client = createClient(key, { onRateLimit: () => setProgress('Torn rate limit reached. Waiting 60 seconds…') });
  try {
    setProgress('Checking your key…');
    const info = await client.keyInfo();
    if (info.level !== 0 && info.level < 3) throw new TornError(16);

    const fromTs = Math.floor(Date.now() / 1000) - days * 86400;
    const attacks = await client.incomingAttacks(fromTs, (n) => setProgress(`Loading your incoming attacks… ${n}`));
    const cache = await openCache();
    const wanted = attacks.filter((a) => a.attacker || a.result === 'Mugged');
    wantedCount = wanted.length;
    const logs = new Map();
    const todo = [];
    for (const a of wanted) {
      const cached = await cache.get(a.code);
      if (cached) logs.set(a.code, cached);
      else todo.push(a);
    }
    state = { client, attacks, logs, result: null };
    render();

    for (let i = 0; i < todo.length && !cancelled; i++) {
      const minutes = Math.ceil(((todo.length - i) * 0.75) / 60);
      setProgress(`Fetching fight logs ${i} / ${todo.length} (about ${minutes} min left)`, i, todo.length);
      try {
        const log = await client.attackLog(todo[i].code);
        if (log) {
          logs.set(todo[i].code, log);
          await cache.put(todo[i].code, log);
        }
      } catch (e) {
        if (e instanceof TornError && FATAL.has(e.code)) throw e;
        // anything else: skip this log and keep going
      }
      if (i % 20 === 19) render();
    }
    render();
    setPartial(logs, wantedCount);
  } catch (e) {
    setError(e.message);
    render();
    if (state && wantedCount) setPartial(state.logs, wantedCount);
  } finally {
    $('working').hidden = true;
    $('analyze').disabled = false;
  }
}

const saved = storedKey.get();
if (saved) {
  $('key').value = saved;
  $('remember').checked = true;
}

$('start-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const key = $('key').value.trim();
  if (!/^[A-Za-z0-9]{16}$/.test(key)) {
    setError('Torn API keys are 16 letters and numbers.');
    return;
  }
  if ($('remember').checked) storedKey.set(key);
  else storedKey.clear();
  run(key, Number($('days').value));
});
$('remember').addEventListener('change', () => { if (!$('remember').checked) storedKey.clear(); });
$('cancel').addEventListener('click', () => { cancelled = true; });
$('only-strong').addEventListener('change', render);
$('clear').addEventListener('click', async () => {
  await (await openCache()).clear();
  storedKey.clear();
  $('key').value = '';
  $('remember').checked = false;
  setError(null);
  state = null;
  profiles.clear();
  for (const id of ['results', 'drill', 'partial']) $(id).hidden = true;
  $('cleared').hidden = false;
});
