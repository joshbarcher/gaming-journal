# Play Log

Per-game session persistence layer. Stores session history (start/end/duration/achievements), an open-session record for crash recovery, and the pre-relay baseline playtime. All data lives in an in-memory `Map` backed by per-game JSON files. Ported into the journal — logic byte-identical to the old relay.

## Data flow

### Startup
1. `bootRelay()` (`src/lib/server/relay/boot.js`) wires `load()` inside the `now-playing` scheduler, before `startNowPlayingPoller()` and `buildAccountCache()` — gated behind `ENABLE_SCHEDULERS` + `SCHED_NOW_PLAYING`.
2. `load()` reads every file in `<relay-data-root>/steam/sessions/` into `_store: Map<appid, gameEntry>`. Idempotent — subsequent calls no-op.
3. After load, all reads are synchronous in-memory. Read-only consumers (achievement sync's `getOpenSession`, the games route's `getLastPlayedMap`) call `load()` lazily too.

### Session open
1. `openSession(appid, name, startedAt)` creates/updates the entry and sets `openSession: { startedAt, achievementsAtStart: [], achievementsDuring: [] }`.
2. Immediately flushes `sessions/{appid}.json` via `_flush(appid)`.

### Mid-session patching
`patchOpenSession(patch)` finds the game with an open session, merges `patch`, flushes. Used by the now-playing poller to persist `achievementsAtStart`/`achievementsDuring` so they survive a restart.

### Session close
`closeSession(appid, endedAt, achievements)` reads `openSession.startedAt`, computes `durationMin` (min 1), prunes sessions older than 30 days, appends `{ startedAt, endedAt, durationMin, achievements }` to `game.sessions[]`, sets `openSession = null`, flushes.

### Baseline
`setBaseline(appid, name, steamTotal, relayTotal)` computes `baseline = steamTotal - relayTotal` (zeroed if ≤ `BASELINE_BUFFER_MIN`). Prevents double-counting: Steam's `playtime_forever` already includes relay-tracked time.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/play-log.service.js` | `load`, `openSession`, `closeSession`, `patchOpenSession`, `clearOpenSession`, `getOpenSession`, `getEffectivePlaytimeMin`, `setBaseline`, `getLastPlayedMap`, `getSessions` |
| `src/lib/server/relay/boot.js` | Wires `load()` (imported as `loadPlayLog`) before the now-playing poller + account cache |
| `src/lib/server/relay/steam/now-playing.service.js` | Sole caller of the write half (open/close/patch/clear/setBaseline) |
| `src/routes/relay/api/steam/playtime/last-played/+server.ts` | GET → `getLastPlayedMap()` (feature `sessions`) |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/sessions/
  {appid}.json   ← { name, baseline, openSession, sessions[] }
```

`openSession` is `null` or `{ startedAt, achievementsAtStart[], achievementsDuring[] }`.
`sessions[]` entries: `{ startedAt, endedAt, durationMin, achievements[] }` where `achievements[]` is `[{ apiname, unlocktime }]`.

## Common questions

**Q: How does restart recovery work?**
`openSession` is flushed to disk the moment a game starts. On restart, the now-playing poller calls `getOpenSession()` (async — scans `_store` for any entry with `openSession !== null`) and restores its live state. If the game stopped while the process was down, the next poll closes the session; `clearOpenSession()` clears a stale open session at startup.

**Q: `getEffectivePlaytimeMin` vs Steam's `playtime_forever`?**
Steam's counter is stale during active sessions. `getEffectivePlaytimeMin(appid)` = `baseline + sum(closedSessions) + elapsedMinutes(openSession)` — a live number used by "now playing" and the library sort.

**Q: What is `BASELINE_BUFFER_MIN` (10 min)?**
Small Steam-vs-relay differences (poll rounding/drift) are stored as `0` rather than a meaningless few-minute baseline.

**Q: Why per-game files instead of one monolith?**
Targeted flushes — only the affected game's file is written per open/close/patch.

## Gotchas

- `_store` uses numeric appid keys. `getEffectivePlaytimeMin(appid)` and `setBaseline` accept string or number — internally `Number(appid)`.
- Sessions pruned to 30 days on `closeSession`. Snapshot-derived `sessions.json` (`sessions.service.js`) is a separate, complementary 30-day record.
- `getLastPlayedMap()`, `getSessions()`, `getEffectivePlaytimeMin()` are synchronous; `openSession`/`closeSession`/`patchOpenSession`/`clearOpenSession`/`getOpenSession`/`setBaseline` are async.
- `patchOpenSession`/`getOpenSession`/`clearOpenSession` scan all entries for the one open session — only one game can be open at a time.
- Dev/schedulers-off instances never load the write half; the store is a boot-time snapshot, so sessions the writer records after load are not visible until restart.
