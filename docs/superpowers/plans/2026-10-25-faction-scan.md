# Faction Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let officers (keys with faction API access) opt in to a faction-wide scan that pools every member's attacks, with a faction view and a member view, without changing personal mode.

**Architecture:** Pooled scoring is an option on the existing pure `analyze()` (`{ pooled, member }`), so personal mode keeps its exact code path. `torn.js` gains faction feed/member calls. `app.js` gains a second, opt-in run that estimates scan size before fetching. Everything stays in the browser.

**Tech Stack:** Plain ES modules, no build, `node --test`, GitHub Pages (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-25-faction-scan-design.md` (builds on `2026-10-22-mugger-id-design.md`)

## Global Constraints

- No server, uploads, dependencies or build step. Only network destination `https://api.torn.com/v2`.
- Faction scan is **strictly opt-in**: never starts from Analyze; nothing heavy runs before the user presses "Start faction scan" after seeing the estimate.
- Estimate copy (verbatim template): `About N fight logs to fetch for <type> — roughly M minutes at Torn's rate limit (other tools using this key will slow down meanwhile). You can cancel at any time; logs already fetched are kept on this device, so a later scan picks up where it stopped.` When nothing is missing: `Ready — no new logs needed.`
- Estimate = needed logs not already cached × 0.75 s.
- Pooled matching: fair fight compared **only** against the candidate's visible fights on the same member (defender). Cross-member-only candidates (no same-member visible fight within ±14 days) cap at Medium, and reach Medium **only** with a strong (distinctive) weapon signal; otherwise Low.
- Repeat-attacker groups never cross members. Most wanted counts direct, non-ambiguous Medium/High matches only.
- Faction scan look-back = form's 30/90/180 days for stealthed attacks; feed paged 14 extra days back.
- Personal mode output must be byte-for-byte unchanged by these options when `pooled` is false (existing tests must pass untouched).
- Release stamp: bump every `?v=` to `5` (index.html script + all relative imports); `tests/release.test.js` enforces it.
- Public repo: anonymized fixtures only; run `grep -rniF -f ../.mugger-id-denylist.txt --exclude-dir=.git .` → must find nothing before each commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Member who has left the faction** (stealthed hits on them are in the feed, but they're missing from `/faction/members`) → still listed, using the name on the attack's `defender` object.
2. **Very large scans** (thousands of logs) → estimate reads in hours and minutes ("about 1 h 15 min"), never "75 minutes" or a negative/NaN.
3. **Running personal Analyze after a faction scan** (or vice versa) → no faction rows, Member column or members counts leak into personal results.
4. **Key with faction access but the feed call fails** (permission revoked, AA removed) → faction panel shows the error and personal results stay usable.
5. **Cancel mid-scan, then switch view/member** → partial banner counts the pooled needed set, not the personal one.

Items 1–3 get tests in Tasks 1 and 3 below; 4–5 are covered by the Task 4 simulation script.

---

### Task 1: Pooled scoring, selection and estimate (pure)

**Files:**
- Modify: `src/analyze.js`
- Create: `tests/fixtures/faction.js`, `tests/faction.test.js`

**Interfaces:**
- Consumes: existing `fingerprint`, `buildCandidates`, `weaponWeights`, `scoreCandidate`, `groupAttacks`, `analyze`, `logsNeeded`.
- Produces:
  - `fingerprint(...)` result gains `defender: { id, name }`.
  - `scoreCandidate(mug, cand, weights, opts = {})` — `opts.pooled: boolean`. Return gains `crossMember: boolean` (true only when pooled and the candidate has no visible fight on `mug.defender.id` within ±14 days).
  - `groupAttacks(results)` — additionally never groups hits whose `mug.defender.id` differ.
  - `analyze(attacks, logs, type = 'mugs', opts = {})` — `opts.pooled: boolean`, `opts.member: number|null` (pooled only: restrict *results* to stealthed hits on that defender; candidates stay pooled). Leaderboard rows gain `members: number` (distinct defenders among that suspect's credited hits). Summary gains `members: number` (distinct defenders among results).
  - `logsNeeded(attacks, type, opts = {})` — when `opts.pooled`: stealthed attacks of the type + visible attacks within ±14 days of at least one of them (any member). Unpooled behaviour unchanged.
  - `scanEstimate(needed, cachedCodes: Set<string>) -> { needed: number, missing: number, seconds: number }` (`seconds = missing * 0.75`).
  - `formatDuration(seconds) -> string`: `< 60` → `"under a minute"`, `< 3600` → `"about M min"` (rounded up), else `"about H h M min"`.
- `tests/fixtures/faction.js` exports `buildFactionDataset() -> { attacks, logs, ids }` with members `MemberA` (1001) and `MemberB` (1002); reuse `attack/attacklog/player` from `dataset.js`, extending `attack()` with a `defender` option (default MemberA, so existing fixtures are unchanged).

- [ ] **Step 1: Write failing tests** in `tests/faction.test.js` (build each scenario in the test from the fixture helpers; names and assertions):
  - `cross-member knife evidence reaches Medium but not High`: SuspectKnife's only visible knife hits are on MemberB (FF 2.00); a stealthed knife mug on MemberA (FF 3.00) → `analyze(..., 'mugs', { pooled: true })` top suspect SuspectKnife, `confidence === 'Medium'`, `crossMember === true`, `signals.ff === 'none'`, reasons include `'FF not comparable (different member)'`.
  - `fair fight from another member never counts, even when equal`: same as above but SuspectKnife's MemberB fight is FF 3.00 → `signals.ff === 'none'`.
  - `cross-member evidence with a common weapon stays Low`: a second pooled attacker also used the knife on MemberB the same week → SuspectKnife `confidence === 'Low'` and not on the leaderboard.
  - `same-member fair fight still counts in pooled mode`: add a visible SuspectKnife knife hit on MemberA FF 3.00 within 3 days → `confidence === 'High'`, `crossMember === false`.
  - `personal analysis is unchanged by pooling code`: `analyze(attacks, logs)` on `buildDataset()` deep-equals its pre-change summary and leaderboard (`{ count: 5, ... }` as asserted in analyze.test.js) and no result has `crossMember === true`.
  - `groups never cross members`: two stealthed Fiveseven hits FF 2.52/2.53 on MemberA and MemberB → `analyze(..., { pooled: true }).groups.length === 0`.
  - `leaderboard counts members hit`: SuspectKnife credited (Medium+) on stealthed hits on both members → row `members === 2`; summary `members === 2`.
  - `member view restricts results but keeps pooled suspects`: `{ pooled: true, member: 1001 }` → every result `mug.defender.id === 1001` and the cross-member suspect still appears.
  - `pooled logsNeeded skips visible attacks outside every 14-day window`: a visible attack 20 days from any stealthed mug is excluded; one 10 days away is included; unpooled `logsNeeded` still includes both.
  - `scanEstimate counts only uncached logs`: 5 needed, 2 codes cached → `{ needed: 5, missing: 3, seconds: 2.25 }`.
  - `formatDuration reads in hours for large scans` (Review Focus 2): `formatDuration(30) === 'under a minute'`, `formatDuration(61) === 'about 2 min'`, `formatDuration(4500) === 'about 1 h 15 min'`.

- [ ] **Step 2: Run** `npm test` — expect the new file to fail (missing exports/fields); all existing tests still pass.

- [ ] **Step 3: Implement** the Interfaces above in `src/analyze.js`. In `scoreCandidate`, when `opts.pooled`, filter the FF comparison set (`near`) to fights with `f.defender.id === mug.defender.id`; compute `crossMember`; when `crossMember`, push `'FF not comparable (different member)'` and, if the weapon reason applies, phrase it as `"<weapon> seen on N other member(s)"`; after `confidenceOf`, demote to `'Low'` when `crossMember && confidence === 'Medium' && signals.weapon !== 'strong'` (High is already impossible without an FF match). `analyze` passes `{ pooled }` through to `scoreCandidate`.

- [ ] **Step 4: Run** `npm test` — all pass (previous 49 + 11 new).

- [ ] **Step 5: Commit** `src/analyze.js tests/faction.test.js tests/fixtures/faction.js tests/fixtures/dataset.js` — "Pooled faction scoring: same-member fair fight, cross-member cap, scan estimate".

---

### Task 2: Faction API calls

**Files:**
- Modify: `src/torn.js`, `tests/torn.test.js`

**Interfaces:**
- Produces on the client object:
  - `keyInfo()` returns `{ level, type, faction: boolean }` (`info.access.faction === true`).
  - `factionAttacks(fromTs, onProgress?) -> attack[]` newest first — same paging, exclusive-`to` and no-progress guard as `incomingAttacks`, on `/faction/attacks?filters=incoming&sort=DESC&limit=100&from=…&to=…`. Extract the shared pager rather than duplicating it.
  - `factionMembers() -> { id, name }[]` from `/faction/members`.

- [ ] **Step 1: Write failing tests**: `keyInfo reports faction access` (true and missing → false); `factionAttacks pages the faction feed` (first URL ends with `/faction/attacks?filters=incoming&sort=DESC&limit=100&from=1000000&to=2000000`, dedupes, stops on short page); `factionMembers maps id and name` (`{ members: [{ id: 1, name: 'A', level: 3 }] }` → `[{ id: 1, name: 'A' }]`). Existing `incomingAttacks` tests must still pass unchanged.
- [ ] **Step 2: Run** `npm test` — new tests fail.
- [ ] **Step 3: Implement** in `src/torn.js`.
- [ ] **Step 4: Run** `npm test` — all pass.
- [ ] **Step 5: Commit** — "Add faction feed and member calls to the API client".

---

### Task 3: Faction panel, views and rendering

**Files:**
- Modify: `index.html`, `src/ui.js`, `src/app.js`; bump release to `v=5` in index.html and every relative import.
- Test: `tests/ui.test.js` (pure helpers only)

**Interfaces:**
- Consumes: Task 1 `analyze(…, { pooled, member })`, `logsNeeded(…, { pooled })`, `scanEstimate`, `formatDuration`; Task 2 `keyInfo().faction`, `factionAttacks`, `factionMembers`.
- Produces (`src/ui.js`):
  - `memberName(id, members: {id,name}[], attacks) -> string` — name from the members list, else from any attack's `defender` with that id, else `"Member [id]"` (Review Focus 1).
  - `renderSummary`, `renderLeaderboard`, `renderMugList`, `renderGroups` accept `{ showMember: boolean, nameOf: (id) => string }` via their options/result; when `showMember`: the summary reads `N stealthed <type> on M members` (+ money for mugs/all, using `summary.members`), leaderboard adds a **Members** column (`r.members`), mug list adds a **Member** column, groups show `· on <member>`, drill-down title adds ` on <member>`.
  - `estimateText(type, estimate) -> string` using the verbatim Global Constraints copy and `formatDuration`.
- DOM (index.html), inside a new `<section id="faction-panel" class="panel" hidden>` placed after `#results`:
  bar title `Faction scan (officers)`; `<details id="faction-details">` collapsed by default containing one-paragraph explanation, `<button id="scan-check">Check scan size</button>`, `<p id="scan-estimate">`, `<button id="scan-start" class="primary" hidden>Start faction scan</button>`; a view toggle `<div class="types" id="views">` with buttons `data-view="faction"` / `data-view="member"` (hidden until a scan has results) and `<select id="member-picker" hidden>`. Add the disclosure row from the spec to the Torn API terms table.
- `src/app.js` state gains `mode: 'personal' | 'faction'`, `view: 'faction' | 'member'`, `member: id|null`, `members: []`. Analyze always resets to `mode: 'personal'` (Review Focus 3) and shows `#faction-panel` only when `keyInfo().faction`. "Check scan size" fetches `factionAttacks(fromTs - 14 days)` + `factionMembers()`, computes `scanEstimate(logsNeeded(attacks, type, { pooled: true }), cachedCodes)`, shows `estimateText`, reveals Start. Start runs the existing `fetchMissingLogs` loop over the pooled needed set and then renders with `analyze(…, { pooled: true, member: view === 'member' ? member : null })`. A feed error shows in `#scan-estimate` and leaves personal results intact (Review Focus 4). Attack-type switches in faction mode re-run the estimate and require Start again only if `missing > 0`. Member picker lists members with ≥1 stealthed attack of the type, sorted by count, labelled via `memberName`.

- [ ] **Step 1: Write failing tests** in `tests/ui.test.js`: `memberName falls back to the attack's defender name, then to an id label` (members list hit; defender-object fallback for a departed member; `"Member [9]"`); `estimateText uses the fixed copy` (`estimateText('mugs', { needed: 10, missing: 4, seconds: 3 })` starts with `About 4 fight logs to fetch for mugs — roughly under a minute`; `missing: 0` → `Ready — no new logs needed.`).
- [ ] **Step 2: Run** `npm test` — those fail.
- [ ] **Step 3: Implement** index.html, ui.js and app.js per Interfaces; bump `?v=5` everywhere.
- [ ] **Step 4: Verify**: `npm test` all pass (including `release.test.js` at v5); `node --check` on every `src/*.js`; every id `app.js` looks up exists in index.html; `grep -n innerHTML src/*.js` finds nothing.
- [ ] **Step 5: Commit** — "Faction scan: opt-in panel, estimate, faction and member views (v5)".

---

### Task 4: End-to-end checks and release (controller)

**Files:** none committed (scripts live in a temp dir or are deleted after running).

- [ ] **Step 1: Simulated page run** — DOM stand-in + fake API (same approach as the selector check) over `buildFactionDataset()` with `keyInfo` reporting `faction: true`: Analyze shows personal results and the faction panel; Check scan size shows the estimate and makes no log calls; Start fetches only the pooled needed set; faction view shows Members/Member columns; member view restricts the list; running Analyze again removes all faction columns (Review Focus 3). Then two failure runs: feed returns `{ error: { code: 16 } }` → message in `#scan-estimate`, personal results still rendered (Review Focus 4); Cancel after 2 logs then switch view → partial banner counts the pooled needed set (Review Focus 5). Expect no `null`, `undefined` or `[object` text anywhere.
- [ ] **Step 2: Live check (local only, real key from ../.env, output never committed)** — run `factionAttacks` + pooled `analyze` in Node for 30 days; confirm the estimate is in the expected range and that cross-member suspects are capped (no High with `crossMember`).
- [ ] **Step 3: Ask the user to try it** (preview or push), then push on "push it" and confirm GitHub Pages serves `app.js?v=5`.
