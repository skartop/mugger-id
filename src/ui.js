import { ATTACK_TYPES, formatDuration } from './analyze.js?v=6';

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

const RESULT_NOUN = { Mugged: 'mug', Hospitalized: 'hospitalization', Attacked: 'attack (left on the street)' };
const RESULT_LABEL = { Mugged: 'Mug', Hospitalized: 'Hospitalization', Attacked: 'Left on street' };
const resultNoun = (result) => RESULT_NOUN[result] ?? `attack (${result.toLowerCase()})`;
const showsMoney = (type) => type === 'mugs' || type === 'all';
const plural = (n, type) => (n === 1 ? ATTACK_TYPES[type].one : ATTACK_TYPES[type].many);

// Faction scan helpers. Name from the members list, else from any attack's defender, else an id label.
export function memberName(id, members, attacks) {
  const listed = members.find((m) => m.id === id)?.name;
  if (listed) return listed;
  const seen = attacks.find((a) => a.defender?.id === id && a.defender?.name)?.defender.name;
  return seen ?? `Member [${id}]`;
}

export function estimateText(type, est) {
  if (est.missing === 0) return 'Ready — no new logs needed.';
  return `About ${est.missing} fight logs to fetch for ${ATTACK_TYPES[type].many} — ${formatDuration(est.seconds)} at Torn's rate limit (other tools using this key will slow down meanwhile). You can cancel at any time; logs already fetched are kept on this device, so a later scan picks up where it stopped.`;
}

export function renderSummary(el, { summary }, { showMember = false } = {}) {
  const c = summary.byConfidence;
  const money_ = showsMoney(summary.type) ? ` (${money(summary.total)})` : '';
  const onMembers = showMember ? ` on ${summary.members} member${summary.members === 1 ? '' : 's'}` : '';
  el.replaceChildren(
    h('p', { class: 'summary' },
      h('strong', {}, `${summary.count} stealthed ${plural(summary.count, summary.type)}${onMembers}${money_}`),
      ` · ${c.High} High · ${c.Medium} Medium · ${c.Low} Low · ${c.None} no likely suspect`,
      summary.ambiguous > 0 ? ` · ${summary.ambiguous} ambiguous` : null),
  );
}

export function renderLeaderboard(el, { leaderboard, summary }, { showMember = false } = {}) {
  if (!leaderboard.length) {
    el.replaceChildren(h('p', { class: 'muted' }, 'No suspects with Medium or High confidence.'));
    return;
  }
  const withMoney = showsMoney(summary.type);
  el.replaceChildren(
    h('div', { class: 'scroll' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Suspect'), h('th', {}, 'Faction'), h('th', { class: 'num' }, 'Hits'),
          showMember && h('th', { class: 'num' }, 'Members'),
          withMoney && h('th', { class: 'num' }, 'Taken'), h('th', {}, 'Best'))),
        h('tbody', {}, leaderboard.map((r) =>
          h('tr', {},
            h('td', {}, profileLink(r)),
            h('td', {}, r.faction ?? 'No faction'),
            h('td', { class: 'num' }, r.hits),
            showMember && h('td', { class: 'num' }, r.members),
            withMoney && h('td', { class: 'num' }, money(r.total)),
            h('td', {}, badge(r.best))))))),
  );
}

export function renderMugList(el, { results, summary }, { onlyStrong, onSelect, showMember = false, nameOf = String }) {
  const { type } = summary;
  const rows = results.filter((r) => !onlyStrong || ['High', 'Medium'].includes(r.suspects[0]?.confidence));
  if (!rows.length) {
    el.replaceChildren(h('p', { class: 'muted' },
      results.length ? `No ${ATTACK_TYPES[type].many} match this filter.` : `No stealthed ${ATTACK_TYPES[type].many} in this period.`));
    return;
  }
  const withMoney = showsMoney(type);
  const withResult = type === 'all';
  el.replaceChildren(
    h('div', { class: 'scroll' },
      h('table', { class: 'clickable' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'When'), showMember && h('th', {}, 'Member'), withResult && h('th', {}, 'Result'), withMoney && h('th', { class: 'num' }, 'Taken'),
          h('th', { class: 'num' }, 'FF'), h('th', {}, 'Weapons'), h('th', {}, 'Top suspect'))),
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
            showMember && h('td', {}, nameOf(r.mug.defender.id)),
            withResult && h('td', {}, RESULT_LABEL[r.mug.result] ?? r.mug.result),
            withMoney && h('td', { class: 'num' }, r.mug.result === 'Mugged' ? money(r.mug.mugAmount) : '—'),
            h('td', { class: 'num' }, ffText(r.mug.ff)),
            h('td', { class: 'wrap' }, weaponsText(r.mug)),
            r.ambiguous
              ? h('td', {}, `${top.candidate.name} or ${r.suspects[1].candidate.name} `, badge(top.confidence), h('span', { class: 'muted' }, ' (ambiguous)'))
              : h('td', {}, top ? `${top.candidate.name} ` : '', badge(top?.confidence)));
        })))),
  );
}

const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const dateSpan = (g) => (day(g.from) === day(g.to) ? day(g.from) : `${day(g.from)} to ${day(g.to)}`);
const ffSpan = (g) => (g.ffMin === g.ffMax ? ffText(g.ffMin) : `${ffText(g.ffMin)}–${ffText(g.ffMax)}`);

function identityText(identity) {
  if (!identity) return 'No direct match';
  if (identity.kind === 'conflict') return `Conflicting matches: ${identity.names.join(', ')}. This group may be wrong.`;
  const rest = identity.total - identity.matched;
  return rest === 0
    ? `Possibly ${identity.name}: matched directly on all ${identity.total} hits.`
    : `Possibly ${identity.name}: matched directly on ${identity.matched} of ${identity.total} hits; the other ${rest} couldn't be verified.`;
}

export function renderGroups(el, { groups, summary }, { onSelect, showMember = false, nameOf = String }) {
  if (!groups.length) {
    el.replaceChildren(h('p', { class: 'muted' }, `No repeat attackers: no two stealthed ${ATTACK_TYPES[summary.type].many} share a weapon and fair fight.`));
    return;
  }
  el.replaceChildren(...groups.map((g) =>
    h('details', { class: 'group' },
      h('summary', {},
        h('strong', {}, g.label), ` · ${g.members.length} hits · ${g.weapons.join(', ')} · FF ${ffSpan(g)}`,
        g.edge ? h('span', { class: 'muted' }, ` (fair fight at the ${g.ffMin === 3 ? 'cap' : 'floor'}, weaker)`) : null,
        ` · ${dateSpan(g)}`,
        showMember ? ` · on ${nameOf(g.members[0].mug.defender.id)}` : null),
      h('p', { class: g.identity?.kind === 'conflict' ? 'error' : 'muted' }, identityText(g.identity)),
      h('ul', { class: 'members' }, g.members.map((m) =>
        h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => onSelect(m) },
          `${when(m.mug.started)} · ${RESULT_LABEL[m.mug.result] ?? m.mug.result} · FF ${ffText(m.mug.ff)} · ${weaponsText(m.mug)}`)))))));
}

function logList(log) {
  return Array.isArray(log?.log) ? h('ol', { class: 'log' }, log.log.map((e) => h('li', {}, e.text))) : h('p', { class: 'muted' }, 'Log unavailable.');
}

export function renderDrilldown(el, row, { logFor, fingerprints, groups = [], loadProfile, onClose, showMember = false, nameOf = String }) {
  const { mug, suspects } = row;
  const group = groups.find((g) => g.label === row.group);
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
        h('summary', {}, showMember ? `Their visible fights on faction members (${fights.length})` : `Their visible fights on you (${fights.length})`),
        h('ul', { class: 'fights' }, fights.map((f) =>
          h('li', {}, h('details', {},
            h('summary', {}, `${when(f.started)}${showMember ? ` · on ${nameOf(f.defender.id)}` : ''} · ${f.result} · FF ${ffText(f.ff)} · ${weaponsText(f)}`),
            logList(logFor(f.code))))))));
  });
  fill(el,
    h('div', { class: 'drill-head' },
      h('h3', {}, `Stealthed ${resultNoun(mug.result)} · ${when(mug.started)}${mug.result === 'Mugged' ? ` · ${money(mug.mugAmount)}` : ''}${showMember ? ` on ${nameOf(mug.defender.id)}` : ''}`),
      h('button', { type: 'button', onclick: onClose }, 'Close')),
    h('p', { class: 'muted' }, `FF ${ffText(mug.ff)} · respect ${mug.respect} · ${mug.overseas ? 'abroad' : 'in Torn City'}`),
    group ? h('p', { class: 'notice' }, `Part of ${group.label} (${group.members.length} hits). ${identityText(group.identity)}`) : null,
    h('h4', {}, 'Fight log'),
    logList(logFor(mug.code)),
    h('h4', {}, 'Suspects'),
    row.ambiguous ? h('p', { class: 'caveat' }, "Two players fit this mug equally well — it can't be pinned on either.") : null,
    blocks.length ? blocks : h('p', { class: 'muted' }, showMember ? 'No likely suspect among the players who attacked faction members openly.' : 'No likely suspect among the players who attacked you openly.'),
    h('p', { class: 'caveat' }, 'Suspects are probable, not proof.'),
  );
}
