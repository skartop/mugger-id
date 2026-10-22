# Mugger ID — Design

**Date:** 2026-10-22
**Status:** Approved in brainstorming, pending spec review

## Purpose

A static web page that faction members open, paste their own Torn API key into, and see which
players most likely made the **stealthed mugs** against them. Matching compares each stealthed
mug with the attackers who hit the same member *without* stealth, using signals that stealth does
not hide (weapons, fair fight, faction status, timing, damage, overseas).

Results are leads, not proof. The page says so wherever a suspect is shown.

## Decisions

| Topic | Decision |
|---|---|
| Data model | Private, in-browser only. No server, no shared database. Each member only sees their own data. |
| Hosting | GitHub Pages, public repo (source is auditable by members). |
| Stack | Plain HTML + ES-module JavaScript, no build step, no external libraries. |
| v1 scope | Suspect matches for stealthed **mugs**; fight-log drill-down. |
| Out of v1 | Unnamed clusters, non-mug stealthed attacks, pooled faction data, faction-key mode. |
| Location | `mugger-id/` folder, its own git repo. |

## Background facts (verified 2026-10-22)

- `GET /v2/user/attacks?filters=incoming&sort=DESC&limit=100&to=<ts>` returns incoming attacks;
  stealthed attacks have `attacker: null`. Fields used: `id, code, started, ended, attacker,
  defender, result, respect_gain, modifiers.fair_fight, modifiers.overseas`.
- `GET /v2/torn/attacklog?log=<code>` returns `attacklog.log[]` (`text, timestamp, action,
  attacker, defender`) and `attacklog.summary[]`. Stealthed attackers appear as "Someone" in text
  but **weapon names, ammo, body part and damage remain in the text**.
- Player names in log text may differ in case from the API name (e.g. `membera` vs `MemberA`);
  comparisons must be case-insensitive.
- `GET /v2/key/info` returns the key's access level. `GET /v2/user/{id}/profile` returns public
  profile incl. `life.maximum`.
- `api.torn.com` sends `Access-Control-Allow-Origin` and allows the `Authorization` header, so
  browser calls with `Authorization: ApiKey <key>` work from any origin.
- Rate limit: 100 calls/min per key, shared with every other tool using that key.

## Architecture

```
mugger-id/
  index.html            page shell, styles, disclosure text
  src/torn.js           API client: auth header, pacing, paging, error mapping
  src/cache.js          IndexedDB cache of attack logs keyed by attack code
  src/parse.js          log text -> attacker-side events (weapon, damage, crit, body part, mug $)
  src/analyze.js        fingerprints + suspect scoring (pure, no network/DOM)
  src/ui.js             rendering of the three page states and drill-down
  src/app.js            wires it together
  tests/*.test.js       node:test unit tests
  tests/fixtures/dataset.js   anonymized fixture builder
```

`parse.js` and `analyze.js` are pure and are the only modules with unit tests in v1.
`torn.js` takes an injectable `fetch` so it can be tested later without network.

## Data flow

1. Member enters key. Call `/v2/key/info`; require access level ≥ Limited, else explain how to make one.
2. Page through incoming attacks back to the look-back window (default 90 days; 30/90/180 options).
3. Select: every stealthed attack with `result == "Mugged"`, and every non-stealthed incoming attack
   (candidates; all results, not only mugs).
4. Fetch attack logs for the selection, skipping codes already in IndexedDB. Pace at ≤ 80 calls/min.
   Progress bar with count and ETA; results render incrementally; Cancel stops further calls.
5. Parse logs, build candidate fingerprints, score each stealthed mug, render results.
6. Suspect profile (`/v2/user/{id}/profile`) fetched only when a drill-down is opened.

## Key handling and disclosure

- Key held in memory. Optional "remember on this device" checkbox stores it in `localStorage`;
  unticking deletes it.
- Key is only ever sent to `api.torn.com`. No analytics, no third-party requests.
- Notice beside the key field:
  *"Your API key is stored only on your own device (and only if you tick 'remember'). It is never
  sent to or stored by this site — it goes straight to api.torn.com."*
- Expandable Torn API ToS disclosure: data storage (local device only), data sharing (none),
  purpose (identify likely attackers in your own attack history), key storage (local only,
  optional), key access level (Limited).
- "Clear cached data" button wipes IndexedDB and any remembered key.

## Parsing (`parse.js`)

For each log entry, classify the actor:
- **Attacker line:** text starts with `Someone` (stealthed) or the attacker's name (case-insensitive).
- **Defender line:** text starts with the defender's name (case-insensitive). Ignored for fingerprinting.

From attacker lines extract:
- weapon: `"Kick"` when the text contains ` kicked `; otherwise the capture of
  `(their|his|her) <Weapon>` up to ` in the`, ` hitting`, ` missing` or end of text, with a trailing
  ` critically` stripped;
- damage: trailing `for <n>`; body part: `in the <part>`; crit: text contains `critically`;
- mug amount from the `mug` action (`$<n>`).

## Scoring (`analyze.js`)

Scoring is per member (fair fight depends on the defender's own stats).

**Candidate fingerprint** (one per visible attacker): weapons used (set + counts), fair-fight values
with timestamps, faction membership (from the API's `attacker.faction` on each visible fight), timestamps
of visible attacks, non-crit damage per weapon, overseas flags.

**Weapon rarity weight** (computed per stealthed mug S): `w(weapon) = 1 / (number of candidates with a
visible attack within ±14 days of S who used it)`. Fists/Kick always weigh 0. A fight whose attacker used
only Fists/Kick gets no weapon signal. (Counting over the whole look-back window would make common
weapons like Diamond Bladed Knife useless even when only one attacker used it that week.)

**Signals for stealthed mug S vs candidate C**

| Signal | Rule |
|---|---|
| Weapon | Strong if S used a weapon C used visibly and its weight ≥ 0.5 ("distinctive"); weak if shared weapon has lower weight; negative if S used non-fist weapons and none appear in C's set. |
| Fair fight | Compare S.ff with C's visible FF values within ±14 days of S. Strong if any within 0.03; moderate within 0.10; negative if all > 0.30 away. If S.ff is exactly 3.0 or 1.0, a match is downgraded one step (cap/floor). |
| Faction status | Uses C's faction on the visible fight nearest in time to S. S.respect > 0 and C had no faction = strong negative (impossible). S.respect == 0 and C in a faction = weak negative (0 respect also happens to faction members). |
| Timing | Strong if C has a visible attack within ±3 days of S; moderate within ±14 days. |
| Damage | Same weapon, median non-crit damage within ±35% → supporting. |
| Overseas | Both overseas within ±3 days → weak supporting. |

**Confidence**
- **High:** distinctive-weapon match AND fair-fight match (strong or moderate, after cap downgrade) AND timing strong; no strong negatives.
- **Medium:** two of {weapon match, fair-fight match, timing ≥ moderate}; no strong negatives.
- **Low:** a weapon match or a fair-fight match (timing alone never qualifies); no strong negatives;
  not weapon-negative.
- Medium and High require no negatives at all (weapon, fair fight or weak faction).
- **Fist/kick-only fights are capped at Low**: without a weapon, fair fight + timing matches random travelers too easily.
- Otherwise not a suspect. Show the top 3 suspects per mug (High > Medium > Low, then by number of
  supporting signals), each with human-readable reasons, e.g.
  `Diamond Bladed Knife used in 4 visible fights · FF 3.00 = 3.00 (cap, weaker) · visible hit 1 day later`.

## Screens (single page)

1. **Start:** key field + remember checkbox + key-storage notice; look-back selector; Analyze;
   expandable ToS disclosure. Clear error messages for invalid key, insufficient access, rate limit (code 5).
2. **Working:** progress bar "Fetching fight logs X / Y — ~N min left", Cancel.
3. **Results:**
   - Summary: count and total $ of stealthed mugs; counts by confidence.
   - Suspect leaderboard (top suspect of each mug, Medium or High only): name, faction, matched mugs,
     total $, best confidence; links to Torn profile.
   - Stealthed mug list (newest first): date, $, FF, weapons, top suspect + badge; filter "High/Medium only".
   - Drill-down (on row click): turn-by-turn log, per-suspect reasons, the matching visible fights
     side-by-side, suspect public profile (level, faction, max life, last action). Visible attacks are
     also drillable.
   - Every suspect display carries "probable, not proof".
- Responsive to ~400px width; light and dark themes via `prefers-color-scheme`.

## Error handling

- Torn error payloads mapped to plain messages (2 incorrect key, 5 too many requests → pause 60s and
  resume automatically, 16 access level too low, 9 API disabled).
- Network failure on a single log: retry twice with back-off, then mark the attack "log unavailable"
  and continue.
- Empty history: friendly "No stealthed mugs in this period" message.

## Testing

`node --test` over `tests/`. The repo is public, so **fixtures contain no real player names, IDs,
faction names or attack codes.** They are modelled on the patterns found during exploration, with
placeholder identities (`MemberA` [1001], `SuspectKnife` [2001], `FactionlessA` [2002], etc.) and
shifted timestamps. Weapons, fair-fight values, respect, overseas flags and damage keep realistic values.
Acceptance cases:

1. Parser counts only attacker-side weapons when the defender's name differs in case (`membera` vs `MemberA`).
2. Knife-only stealthed mugs at FF 3.00 within days of `SuspectKnife`'s visible knife-only FF 3.00
   hits → **High**, top suspect `SuspectKnife`.
3. Overseas fist/kick-only stealthed mugs → no suspect above Low.
4. Factionless (respect 0) Macana mugs vs two factionless visible muggers who never used a Macana →
   neither rated Medium or High.
5. Weapon rarity: Fists/Kick contribute no weapon signal.

Manual check before publishing (not committed): run in a browser with real keys and compare with the
exploration results.

## Deployment

Public GitHub repo `mugger-id`, GitHub Pages serving the repo root from `main`. README explains what
the tool does, the key-handling promise, and how to run tests.
