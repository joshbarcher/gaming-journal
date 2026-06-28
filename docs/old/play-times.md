# Playtime: Source of Truth

## The Core Problem

**Steam's `playtime_forever` (and the enriched `playtimeMinutes`) are stale while a game is running.**

Steam does not update its playtime counter until a game session is *closed*. That means any value we read from Steam during an active session is the playtime from *before* the session started — which can be hours behind reality.

We have our own relay poller that tracks sessions precisely. That is the source of truth.

---

## The Rule

**Never read Steam playtime values anywhere in the app.** The relay is the single source of truth for all playtime — historical and live.

- **Historical playtime** (library, hall of fame, abandoned, vault, etc.) comes from `effectiveMin`, which includes the `baseline` set by the migration (pre-relay history) plus all tracked sessions.
- **Live playtime** is `effectiveMin` with the open session elapsed added in real-time by the relay.

The relay server overlays `playtime_forever` (on `/relay/api/steam/games`) and `playtimeMinutes` (on `/relay/api/games/:appid`) with `effectiveMin` before any response leaves the server. Consumers read the already-correct field — no client-side patching needed.

---

## Active-session playtime — ⚠️ extra care needed

Any UI that needs to reflect **how long the player has been playing in the current session** (e.g. live timers, HLTB pin) must be careful not to double-count the session time already included in `effectiveMin`.

The relay poller exposes:
- **`/relay/api/steam/now-playing`** — `{ playing: { appid, sessionStartedAt, achievementsDuring, ... } }`
- **`/relay/api/steam/playtime/last-played`** — `{ [appid]: { lastPlayedAt, effectiveMin } }` — relay-computed total including the running session

`effectiveMin` is the correct total to use when you need an accurate "total hours including this session" number.

---

## The Correct Pattern

For live pins and timers, the key insight is: **`effectiveMin` (= `game.playtimeMinutes`) already includes session elapsed up to the moment it was fetched.** Elapsed time must be measured from render time, not from session start, to avoid double-counting.

```js
// 1. Fetch game data — playtimeMinutes IS effectiveMin (relay-computed, includes live elapsed)
const game       = await fetch(`/relay/api/games/${appid}`).then(r => r.json())
const renderTime = Date.now()   // mark when effectiveMin was captured

// 2. Also fetch now-playing to know if a session is active
const np      = await fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null)
const session = np?.playing?.appid === Number(appid) ? np.playing : null

// 3. Store base — DO NOT add session elapsed; it's already in effectiveMin
let basePlaytimeMin = game.playtimeMinutes ?? 0

// 4. Live timer: add delta from renderTime (not from sessionStartedAt)
const update = () => {
    const deltaMins = Math.floor((Date.now() - renderTime) / 60_000)
    updatePin(basePlaytimeMin + deltaMins)
}

// 5. When a background poll refreshes playtimeMinutes (new effectiveMin),
//    only update basePlaytimeMin when no session timer is running.
//    If the timer IS running, it already advances correctly from renderTime;
//    updating the base would double-count the session elapsed.
if (!sessionTimerActive) {
    basePlaytimeMin = Math.max(basePlaytimeMin, newGame.playtimeMinutes)
    updatePin(basePlaytimeMin)
}
```

---

## Status (as of 2026-05-26)

All known Steam playtime references have been removed. The relay is now the sole source of truth end-to-end.

### Relay server (✅ fixed)

| File | Change |
|---|---|
| `games.controller.js` | Always sets `playtimeMinutes = effectiveMin` — no `> 0` guard |
| `steam.controller.js` | Always sets `playtime_forever = effectiveMin` — no `> 0` guard |
| `account.service.js` | `_effMin()` returns relay value directly — no Steam fallback |

### Frontend (✅ fixed)

| File | Change |
|---|---|
| `home.js` | Always sets `playtime_forever = effectiveMin` — no `> 0` guard |
| `game.js` | `_gpBasePlaytimeMin = effectiveMin`; timer uses `Date.now() - _gpRenderTime` delta |
| `game-journal.js` | `basePlaytimeMins = game.playtimeMinutes`; timer uses `renderTime` delta; slow poll skips base update while session timer is active |

### Views that read `playtime_forever` from `/relay/api/steam/games` (✅ correct after relay fix)

`library.js`, `abandoned.js`, `favorites.js`, `hall-of-fame.js`, `on-hold.js`, `vault.js`, `franchises.js` all receive `playtime_forever` already overlaid with `effectiveMin` by the relay server. No client-side changes needed.

---

## Fields Reference

| Field | Source | Updated when | Use for |
|---|---|---|---|
| `game.playtimeMinutes` | Relay-enriched Steam | Session closes | Historical display, HLTB base (stale during session) |
| `steamGame.playtime_forever` | Raw Steam API | Session closes | Same as above — stale during session |
| `nowPlaying.playing.sessionStartedAt` | Relay poller | Real-time | Computing elapsed minutes for live pin/timer |
| `lastPlayedMap[appid].effectiveMin` | Relay poller | Real-time | Accurate total playtime during active session |
| `lastPlayedMap[appid].lastPlayedAt` | Relay poller | Real-time | Accurate last-played timestamp |
| `accountData.sessions[appid].sessions[].durationMin` | Relay sessions DB | Session closes | Accurate historical session durations |
