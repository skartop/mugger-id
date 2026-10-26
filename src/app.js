import { createClient, TornError } from './torn.js?v=6';
import { openCache } from './cache.js?v=6';
import { analyze, logsNeeded, scanEstimate, ATTACK_TYPES, DAY } from './analyze.js?v=6';
import { attacksToCsv, exportFilename } from './export.js?v=6';
import { renderSummary, renderLeaderboard, renderGroups, renderMugList, renderDrilldown, memberName, estimateText } from './ui.js?v=6';

const KEY_STORE = 'mugger-id:key';
const $ = (id) => document.getElementById(id);
const storedKey = {
  get() { try { return localStorage.getItem(KEY_STORE); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY_STORE, v); } catch { /* storage blocked */ } },
  clear() { try { localStorage.removeItem(KEY_STORE); } catch { /* storage blocked */ } },
};

const FATAL = new Set([2, 5, 8, 9, 10, 13, 16, 18]); // errors where continuing cannot help
let cancelled = false;
let busy = false;
// { client, attacks, logs, cache, type, result, fromTs, mode: 'personal' | 'faction', view: 'faction' | 'member',
//   member, members, fattacks, factionLoaded }. Fight logs for both modes share one `logs` map (keyed by attack code).
let state = null;
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
  const faction = state.mode === 'faction';
  if (faction) refreshPicker();
  state.result = faction
    ? analyze(state.fattacks, state.logs, state.type, { pooled: true, since: state.fromTs, member: state.view === 'member' ? (state.member ?? -1) : null })
    : analyze(state.attacks, state.logs, state.type);
  // Member column and "on <member>" only in the pooled faction view; member view reads like personal mode.
  const showMember = faction && state.view === 'faction';
  const nameOf = (id) => memberName(id, state.members, state.fattacks);
  $('results').hidden = false;
  $('list-title').textContent = `Stealthed ${ATTACK_TYPES[state.type].many}`;
  renderSummary($('summary'), state.result, { showMember });
  renderLeaderboard($('leaderboard'), state.result, { showMember });
  renderGroups($('groups'), state.result, { onSelect: openDrill, showMember, nameOf });
  renderMugList($('mugs'), state.result, { onlyStrong: $('only-strong').checked, onSelect: openDrill, showMember, nameOf });
  setPartial();
}

// Downloads every loaded attack (this mode's whole feed, visible and stealthed) as a CSV file.
function exportCsv() {
  if (!state) return;
  const faction = state.mode === 'faction';
  const csv = faction
    ? attacksToCsv(state.fattacks, state.logs, { pooled: true, since: state.fromTs })
    : attacksToCsv(state.attacks, state.logs);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename(faction ? 'faction' : 'personal');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const neededLogs = () => (state.mode === 'faction'
  ? logsNeeded(state.fattacks, state.type, { pooled: true, since: state.fromTs })
  : logsNeeded(state.attacks, state.type));

// Members with at least one stealthed attack of the selected type, most first.
function stealthedByMember() {
  const allowed = ATTACK_TYPES[state.type].results;
  const counts = new Map();
  for (const a of state.fattacks) {
    if (a.attacker || a.defender?.id == null || a.started < state.fromTs || !(allowed === null || allowed.includes(a.result))) continue;
    counts.set(a.defender.id, (counts.get(a.defender.id) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function refreshPicker() {
  const entries = stealthedByMember();
  if (!entries.some(([id]) => id === state.member)) state.member = entries[0]?.[0] ?? null;
  const picker = $('member-picker');
  picker.replaceChildren(...entries.map(([id, n]) => {
    const o = document.createElement('option');
    o.value = String(id);
    o.textContent = `${memberName(id, state.members, state.fattacks)} (${n})`;
    return o;
  }));
  if (state.member != null) picker.value = String(state.member);
  syncFactionControls();
}

function syncFactionControls() {
  const faction = state?.mode === 'faction';
  $('views').hidden = !faction;
  $('member-picker').hidden = !(faction && state.view === 'member');
  for (const b of document.querySelectorAll('#views button')) b.setAttribute('aria-pressed', String(b.dataset.view === state?.view));
}

// Banner while some logs the selected type needs are still missing.
function setPartial() {
  const needed = neededLogs();
  const loaded = needed.filter((a) => state.logs.has(a.code)).length;
  const missing = loaded < needed.length;
  $('partial').hidden = !missing;
  $('partial').textContent = missing
    ? `Partial results — ${loaded} of ${needed.length} fight logs loaded. Confidence may be overstated; ${state.mode === 'faction' ? 'press Start faction scan to finish' : 'run Analyze again to finish'}.`
    : '';
}

function showType(type) {
  for (const b of document.querySelectorAll('#results .types button')) b.setAttribute('aria-pressed', String(b.dataset.type === type));
}

function setBusy(on) {
  busy = on;
  $('working').hidden = !on;
  $('analyze').disabled = on;
  for (const b of document.querySelectorAll('.types button')) b.disabled = on;
  for (const id of ['scan-check', 'scan-start', 'member-picker', 'export']) $(id).disabled = on;
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
    groups: state.result.groups,
    showMember: state.mode === 'faction',
    nameOf: (id) => memberName(id, state.members, state.fattacks),
    loadProfile,
    onClose: () => { el.hidden = true; },
  });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Fetches the logs the selected type still needs (device cache first), rendering as they arrive.
async function fetchMissingLogs() {
  const todo = [];
  for (const a of neededLogs()) {
    if (state.logs.has(a.code)) continue;
    const cached = await state.cache.get(a.code);
    if (cached) state.logs.set(a.code, cached);
    else todo.push(a);
  }
  render();
  for (let i = 0; i < todo.length && !cancelled; i++) {
    const minutes = Math.ceil(((todo.length - i) * 0.75) / 60);
    setProgress(`Fetching fight logs ${i} / ${todo.length} (about ${minutes} min left)`, i, todo.length);
    try {
      const log = await state.client.attackLog(todo[i].code);
      if (log) {
        state.logs.set(todo[i].code, log);
        await state.cache.put(todo[i].code, log);
      }
    } catch (e) {
      if (e instanceof TornError && FATAL.has(e.code)) throw e;
      // anything else: skip this log and keep going
    }
    const every = state.mode === 'faction' ? 100 : 20; // pooled analysis is heavier: render less often
    if (i % every === every - 1) render();
  }
  render();
}

async function run(key, days) {
  cancelled = false;
  setError(null);
  $('cleared').hidden = true;
  $('drill').hidden = true;
  $('partial').hidden = true;
  // Analyze is always personal mode; a faction scan is a separate, explicit opt-in.
  // Drop the previous run entirely so a failed Analyze can never leave the panel wired to an old key's state.
  state = null;
  $('results').hidden = true;
  $('faction-panel').hidden = true;
  resetFactionPanel();
  showType('mugs');
  setBusy(true);
  let factionAccess = false;
  const client = createClient(key, { onRateLimit: () => setProgress('Torn rate limit reached. Waiting 60 seconds…') });
  try {
    setProgress('Checking your key…');
    const info = await client.keyInfo();
    if (info.level !== 0 && info.level < 3) throw new TornError(16);
    factionAccess = info.faction;

    const fromTs = Math.floor(Date.now() / 1000) - days * 86400;
    const attacks = await client.incomingAttacks(fromTs, (n) => setProgress(`Loading your incoming attacks… ${n}`));
    state = {
      client, attacks, logs: new Map(), cache: await openCache(), type: 'mugs', result: null, fromTs,
      mode: 'personal', view: 'faction', member: null, members: [], fattacks: [], factionLoaded: false,
    };
    await fetchMissingLogs();
  } catch (e) {
    setError(e.message);
    render();
  } finally {
    setBusy(false);
    $('faction-panel').hidden = !(factionAccess && state);
  }
}

function resetFactionPanel() {
  $('scan-estimate').hidden = true;
  $('scan-estimate').textContent = '';
  $('scan-start').hidden = true;
  $('views').hidden = true;
  $('member-picker').hidden = true;
}

// Estimate for the selected type: logs already on this device (memory or cache) cost nothing.
async function estimateFaction() {
  const needed = logsNeeded(state.fattacks, state.type, { pooled: true, since: state.fromTs });
  const cachedCodes = new Set();
  for (const a of needed) {
    if (state.logs.has(a.code)) { cachedCodes.add(a.code); continue; }
    const cached = await state.cache.get(a.code);
    if (cached) {
      state.logs.set(a.code, cached);
      cachedCodes.add(a.code);
    }
  }
  return scanEstimate(needed, cachedCodes);
}

function showEstimate(est) {
  $('scan-estimate').textContent = estimateText(state.type, est);
  $('scan-estimate').hidden = false;
  $('scan-start').hidden = false;
}

// Estimate for the current type; Start is only offered while something is still missing.
async function refreshEstimate() {
  const est = await estimateFaction();
  showEstimate(est);
  if (est.missing === 0) $('scan-start').hidden = true;
}

const NO_FACTION_ACCESS = "This key can't read your faction's attacks. Your faction role needs API access (ask a leader to enable it in faction settings), and the key needs faction access.";

function showScanError(prefix, e) {
  $('scan-estimate').textContent = e instanceof TornError && (e.code === 16 || e.code === 7) ? NO_FACTION_ACCESS : `${prefix}${e.message}`;
  $('scan-estimate').hidden = false;
  $('scan-start').hidden = true;
}

async function checkScan() {
  if (busy || !state) return;
  cancelled = false;
  setBusy(true);
  try {
    setProgress('Loading your faction\u2019s incoming attacks…');
    const [fattacks, members] = await Promise.all([
      state.client.factionAttacks(state.fromTs - 14 * DAY, (n) => setProgress(`Loading your faction\u2019s incoming attacks… ${n}`)),
      state.client.factionMembers(),
    ]);
    state.fattacks = fattacks;
    state.members = members;
    state.factionLoaded = true;
    setProgress('Counting fight logs already on this device…');
    showEstimate(await estimateFaction());
  } catch (e) {
    // Personal results stay as they are; the error belongs to the scan.
    showScanError('Could not check the faction feed: ', e);
  } finally {
    setBusy(false);
  }
}

async function startScan() {
  if (busy || !state) return;
  cancelled = false;
  setError(null);
  $('drill').hidden = true;
  state.mode = 'faction';
  setBusy(true);
  try {
    setProgress('Checking which fight logs are needed…');
    await fetchMissingLogs();
    setProgress('Counting fight logs already on this device…');
    await refreshEstimate(); // Start goes away when done; a cancelled scan shows what is left
  } catch (e) {
    showScanError('The faction scan stopped: ', e);
    render();
  } finally {
    setBusy(false);
  }
  syncFactionControls();
}

function setView(view) {
  if (busy || !state || state.mode !== 'faction') return;
  state.view = view;
  $('drill').hidden = true;
  render();
}

async function switchType(type) {
  if (busy || !state || type === state.type) return;
  cancelled = false;
  setError(null);
  $('drill').hidden = true;
  state.type = type;
  showType(type);
  setBusy(true);
  try {
    if (state.mode !== 'faction') {
      setProgress('Checking which fight logs are needed…');
      await fetchMissingLogs();
    }
    if (state.factionLoaded) {
      // Counts can be large: re-estimate for the new type (never leave an old estimate or Start showing),
      // and only offer Start when something is missing.
      setProgress('Counting fight logs already on this device…');
      await refreshEstimate();
    }
    render(); // always: title, lists and the partial banner must follow the new type
  } catch (e) {
    setError(e.message);
    render();
  } finally {
    setBusy(false);
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
$('export').addEventListener('click', exportCsv);
for (const b of document.querySelectorAll('#results .types button')) b.addEventListener('click', () => switchType(b.dataset.type));
$('scan-check').addEventListener('click', checkScan);
$('scan-start').addEventListener('click', startScan);
for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => setView(b.dataset.view));
$('member-picker').addEventListener('change', () => {
  if (busy || !state) return;
  state.member = Number($('member-picker').value);
  $('drill').hidden = true;
  render();
});
$('clear').addEventListener('click', async () => {
  await (await openCache()).clear();
  storedKey.clear();
  $('key').value = '';
  $('remember').checked = false;
  setError(null);
  state = null;
  profiles.clear();
  for (const id of ['results', 'drill', 'partial', 'faction-panel']) $(id).hidden = true;
  resetFactionPanel();
  $('cleared').hidden = false;
});
