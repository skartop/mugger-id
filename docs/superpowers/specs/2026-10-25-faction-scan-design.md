# Mugger ID — Faction scan (pooled faction data)

**Date:** 2026-10-25
**Status:** Approved in brainstorming (pending document review)
**Builds on:** `2026-10-22-mugger-id-design.md` (v1), plus the shipped attack-type selector and Repeat attackers panel.

## Intent

Today each member only sees stealthed hits on themselves, matched against attackers who hit
*them* openly. But an attacker who mugs one member openly is often the same person stealth-mugging
another. Pooling the faction's attacks lets one member's visible hit unmask stealthed hits on others.

The key insight: a key with **faction API access** (Torn's AA permission) can already read the
faction's whole incoming-attack feed, stealthed hits included. So pooling needs **no server and no
uploads** — it runs in the officer's browser exactly like personal mode, and only sees what Torn
already lets that key see. The "nothing stored anywhere but your device" promise stays intact.

## Goals

- Officers (keys with faction access) can opt in to a **faction scan** covering every member.
- Two views of a faction scan, switchable:
  - **Faction view** — one "Most wanted" and one "Repeat attackers" across all members.
  - **Member view** — pick a member; see their stealthed attacks, matched against everyone's open hits.
- The attack-type selector (Mugs / Hospitalizations / Left on the street / All stealthed) works in both views.
- Personal mode is unchanged and remains the default for everyone.

## Non-goals

- No server, database, uploads, or sharing between members' browsers.
- Members without faction access gain nothing new (they never see faction options).
- No change to v1 scoring rules for personal mode.

## Anti-goals (would make this a failure even if it technically works)

- Defaulting to, or silently starting, a long faction scan. **The user said 5–10 minutes is too long
  to be a default; faction scanning must be strictly opt-in with a clear time disclaimer.**
- Cross-member evidence inflating confidence: a match built on fair fight from a *different*
  member's fight is meaningless and must never count (see Matching).
- Accusing someone at High on cross-member evidence alone.

## Constraints

- Static GitHub Pages site, plain ES modules, no build, no dependencies (as v1). Release stamp `?v=`
  bumped on every change (see README "Releasing a change").
- API pacing ≤ 80 calls/min per key, shared with any other tool on that key.
- Public repo: tests use anonymized fixtures only.
- Faction feed: `GET /v2/faction/attacks?filters=incoming&sort=DESC&limit=100&from=&to=` (paged; `to`
  is exclusive, same paging as `incomingAttacks`). Member names/IDs: `GET /v2/faction/members`.
  Faction access is reported by `GET /v2/key/info` as `info.access.faction === true` (verified live
  2026-10-25). Keys without access couldn't be tested: if the feed call returns an access error, treat
  the key as personal-only.
- **Verified live (2026-10-22/25):** the faction feed returns the same attack objects as the personal
  feed — `code`, `attacker: null` when stealthed, `defender {id, name}`, `result`, `respect_gain`,
  `modifiers.fair_fight`, `modifiers.overseas`, attacker `faction` — and `/v2/torn/attacklog?log=<code>`
  works for any member's attack code with a faction-access key (used to analyse a member's 90-day history).

## Decided with the user

- **Both views**, toggled.
- **Opt-in only**, never the default, with a disclaimer about scan time before it starts.
- Repeat-attacker groups and possible identities remain notes; "Most wanted" counts direct matches only
  (carried over from the Repeat attackers decision).

## Design

### Entry point and opt-in

- Analyze works as today (personal mode). After it finishes, if the key has faction access, a new
  panel appears: **"Faction scan (officers)"**, collapsed by default, with a short explanation and a
  **"Check scan size"** button.
- "Check scan size" pages the faction feed for the chosen look-back (cheap: ~1 call per 100 attacks)
  and shows an estimate before anything heavy happens:
  *"About N fight logs to fetch for <type> — roughly M minutes at Torn's rate limit (other tools using
  this key will slow down meanwhile). You can cancel at any time; logs already fetched are kept on
  this device, so a later scan picks up where it stopped."*
  plus a **"Start faction scan"** button. Estimate = logs not already cached × 0.75 s.
- Only after "Start faction scan" does log fetching begin, with the existing progress bar and Cancel.
- Switching the attack type in faction mode re-estimates and asks again only if new logs are needed
  beyond what's cached (same pattern as personal mode's lazy type switching, but with the estimate
  shown first because counts can be large).

### What gets fetched (keeping scans short)

For the selected attack type across all members:
- every **stealthed** attack of that type;
- every **visible** attack by an attacker who has at least one visible fight within ±14 days of at
  least one of those stealthed attacks (on any member). Attackers with no fight near any stealthed
  attack cannot influence a match beyond Low and are skipped entirely. *(Ruling from the final
  review: selection is by attacker, not by individual fight date, so a kept attacker's fights are
  complete and weapon rarity agrees with personal results.)*

### Matching across members

Pooled candidates = attackers seen openly hitting **any** member. Each stealthed attack is scored
against them with the v1 rules, with one change:

- **Fair fight is only compared against the candidate's visible fights on the same member** (the
  same defender). Fights on other members contribute weapon, timing, faction-status, damage and
  overseas signals, but never a fair-fight signal. A suspect whose only evidence is on other members
  therefore cannot have an FF match — and since High requires an FF match, cross-member-only
  evidence caps at **Medium**. Reasons say so: e.g. "seen with Diamond Bladed Knife on 2 other
  members · FF not comparable (different member)".
- **Decided with the user — cross-member-only evidence needs a distinctive weapon:** when a candidate
  has no visible fight on the same member within ±14 days, Medium requires a *strong* weapon signal
  (the only pooled candidate seen using it within ±14 days). A common ("weak") weapon plus timing stays
  **Low** and never reaches Most wanted. Same-member evidence keeps the v1 rules unchanged.
- *Builder's call (recorded):* "cross-member-only" means the candidate has **no** visible fight on the
  stealthed attack's member within ±14 days. If they have one, FF is compared against those same-member
  fights and High is possible under v1 rules; weapon and timing evidence may come from any member.
- Weapon rarity is computed across the pooled candidates active within ±14 days (as v1).
- Damage comparison stays as v1 but is noted as weaker across members (defender armour differs);
  it is supporting-only already, so no rule change.

### Faction view

- **Summary**: "N stealthed <type> on M members" (+ money for mugs/all).
- **Most wanted (faction)**: top suspect per stealthed attack (Medium/High, non-ambiguous), aggregated:
  suspect, faction, hits, **members hit**, taken (mugs/all), best confidence.
- **Repeat attackers (faction)**: groups are formed **within each member only** (grouping uses fair
  fight, which isn't comparable across members). Listed together with the member's name. A group's
  possible identity uses pooled direct matches as in personal mode.
- **Attack list**: all members' stealthed attacks, with a **Member** column; drill-down as today plus
  "on <member>".

### Member view

- A member picker (members with at least one stealthed attack of the selected type, sorted by count).
- Shows exactly the personal-mode panels for that member, but suspects come from the pooled
  candidates and reasons mark cross-member evidence.

### Personal mode

- Unchanged. If the key has faction access, personal mode stays scoped to the key owner's own
  attacks, as now.

### Disclosure

- The Torn API terms table gains a row for faction mode: "Faction scan (optional, officers): reads
  your faction's attack feed that your key can already see; processed and cached on this device
  only." The key notice is unchanged.

## Calls made while reviewing (recorded so they can be checked)

- **Look-back:** the faction scan reuses the form's 30/90/180-day choice for stealthed attacks, and pages
  the feed 14 days further back so visible attacks inside the earliest ±14-day windows are available.
- **Estimate:** exact count of needed logs not already in the device cache (logs fetched for another
  attack type or by personal mode count as cached) × 0.75 s. No hard cap; the disclaimer and Cancel
  cover very large scans. When nothing is missing: "Ready — no new logs needed."

## Left to the builder

- Exact layout of the faction panel, picker and view toggle, within the existing Torn theme.
- Module boundaries (e.g. a `faction.js` for feed/members fetching; scoring changes inside `analyze.js`
  via an option such as `{ pooled: true }` that turns on the same-defender FF rule).
- How the estimate is phrased when everything is already cached ("Ready — no new logs needed").
- Test design, using anonymized multi-member fixtures (at minimum: cross-member weapon match caps at
  Medium; FF from another member never counts; same-member FF still counts; grouping never crosses
  members; fetch selection skips visible attacks outside every ±14-day window).
