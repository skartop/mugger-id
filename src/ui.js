// Rendering only. Every string from the API goes in as a text node, never as HTML.

// Flattens nested child arrays and drops null/undefined/false, so optional children can be
// written inline. The DOM's own append/replaceChildren would turn these into text instead.
export const childList = (children) => children.flat(Infinity).filter((c) => c != null && c !== false);

const toNode = (c) => (c instanceof Node ? c : String(c));

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...childList(children).map(toNode));
  return el;
}

const fill = (el, ...children) => el.replaceChildren(...childList(children).map(toNode));

export const money = (n) => `$${(n ?? 0).toLocaleString('en-US')}`;
export const when = (ts) => `${new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} TCT`;
const profileUrl = (id) => `https://www.torn.com/profiles.php?XID=${id}`;
const profileLink = (p) => h('a', { href: profileUrl(p.id), target: '_blank', rel: 'noopener' }, `${p.name} [${p.id}]`);
const badge = (c) => h('span', { class: `badge ${c ? c.toLowerCase() : 'none'}` }, c ?? 'No suspect');
const weaponsText = (fp) => Object.keys(fp.weapons).join(', ') || (fp.logMissing ? 'log unavailable' : '—');
const ffText = (ff) => (ff == null ? '—' : ff.toFixed(2));

export function renderSummary(el, { summary }) {
  const c = summary.byConfidence;
  el.replaceChildren(
    h('p', { class: 'summary' },
      h('strong', {}, `${summary.count} stealthed mugs (${money(summary.total)})`),
      ` · ${c.High} High · ${c.Medium} Medium · ${c.Low} Low · ${c.None} no likely suspect`,
      summary.ambiguous > 0 ? ` · ${summary.ambiguous} ambiguous` : null),
  );
}

export function renderLeaderboard(el, { leaderboard }) {
  if (!leaderboard.length) {
    el.replaceChildren(h('p', { class: 'muted' }, 'No suspects with Medium or High confidence.'));
    return;
  }
  el.replaceChildren(
    h('div', { class: 'scroll' },
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Suspect'), h('th', {}, 'Faction'), h('th', { class: 'num' }, 'Mugs'), h('th', { class: 'num' }, 'Taken'), h('th', {}, 'Best'))),
        h('tbody', {}, leaderboard.map((r) =>
          h('tr', {},
            h('td', {}, profileLink(r)),
            h('td', {}, r.faction ?? 'No faction'),
            h('td', { class: 'num' }, r.mugs),
            h('td', { class: 'num' }, money(r.total)),
            h('td', {}, badge(r.best))))))),
  );
}

export function renderMugList(el, { results }, { onlyStrong, onSelect }) {
  const rows = results.filter((r) => !onlyStrong || ['High', 'Medium'].includes(r.suspects[0]?.confidence));
  if (!rows.length) {
    el.replaceChildren(h('p', { class: 'muted' }, results.length ? 'No mugs match this filter.' : 'No stealthed mugs in this period.'));
    return;
  }
  el.replaceChildren(
    h('div', { class: 'scroll' },
      h('table', { class: 'clickable' },
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', { class: 'num' }, 'Taken'), h('th', { class: 'num' }, 'FF'), h('th', {}, 'Weapons'), h('th', {}, 'Top suspect'))),
        h('tbody', {}, rows.map((r) => {
          const top = r.suspects[0];
          const open = () => onSelect(r);
          return h('tr', { tabindex: 0, role: 'button', onclick: open, onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (e.key === ' ') e.preventDefault();
              open();
            }
          } },
            h('td', {}, when(r.mug.started)),
            h('td', { class: 'num' }, money(r.mug.mugAmount)),
            h('td', { class: 'num' }, ffText(r.mug.ff)),
            h('td', {}, weaponsText(r.mug)),
            r.ambiguous
              ? h('td', {}, `${top.candidate.name} or ${r.suspects[1].candidate.name} `, badge(top.confidence), h('span', { class: 'muted' }, ' (ambiguous)'))
              : h('td', {}, top ? `${top.candidate.name} ` : '', badge(top?.confidence)));
        })))),
  );
}

function logList(log) {
  return Array.isArray(log?.log) ? h('ol', { class: 'log' }, log.log.map((e) => h('li', {}, e.text))) : h('p', { class: 'muted' }, 'Log unavailable.');
}

export function renderDrilldown(el, row, { logFor, fingerprints, loadProfile, onClose }) {
  const { mug, suspects } = row;
  const blocks = suspects.map((s) => {
    const profileBox = h('p', { class: 'muted' }, 'Loading profile…');
    loadProfile(s.candidate.id)
      .then((p) => profileBox.replaceChildren(
        `Level ${p?.level ?? '?'} · ${p?.status?.description ?? ''} · Max life ${p?.life?.maximum?.toLocaleString('en-US') ?? '?'} · Last action ${p?.last_action?.relative ?? '?'}`))
      .catch((e) => profileBox.replaceChildren(`Profile unavailable: ${e.message}`));
    const fights = fingerprints.filter((f) => f.attacker?.id === s.candidate.id).sort((a, b) => b.started - a.started);
    return h('section', { class: 'suspect' },
      h('h4', {}, profileLink(s.candidate), ' ', badge(s.confidence)),
      h('p', { class: 'muted' }, s.candidate.faction ?? 'No faction'),
      h('ul', {}, s.reasons.map((r) => h('li', {}, r))),
      profileBox,
      h('details', {},
        h('summary', {}, `Their visible fights on you (${fights.length})`),
        h('ul', { class: 'fights' }, fights.map((f) =>
          h('li', {}, h('details', {},
            h('summary', {}, `${when(f.started)} · ${f.result} · FF ${ffText(f.ff)} · ${weaponsText(f)}`),
            logList(logFor(f.code))))))));
  });
  fill(el,
    h('div', { class: 'drill-head' },
      h('h3', {}, `Stealthed mug · ${when(mug.started)} · ${money(mug.mugAmount)}`),
      h('button', { type: 'button', onclick: onClose }, 'Close')),
    h('p', { class: 'muted' }, `FF ${ffText(mug.ff)} · respect ${mug.respect} · ${mug.overseas ? 'abroad' : 'in Torn City'}`),
    h('h4', {}, 'Fight log'),
    logList(logFor(mug.code)),
    h('h4', {}, 'Suspects'),
    row.ambiguous ? h('p', { class: 'caveat' }, "Two players fit this mug equally well — it can't be pinned on either.") : null,
    blocks.length ? blocks : h('p', { class: 'muted' }, 'No likely suspect among the players who attacked you openly.'),
    h('p', { class: 'caveat' }, 'Suspects are probable, not proof.'),
  );
}
