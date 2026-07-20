# Pin

Tracks the currently "pinned" game — a short-duration spotlight surfaced while a game is being played. Set automatically when a session starts, cleared when it ends (after a grace period). Drives a periodic Reddit content refresh while active. Folded into the gaming-journal SvelteKit app.

## Data flow

### Pin set (session start)
1. `now-playing.service.js` calls `pin.set(appid, name, 'playing')` when a new session is detected.
2. `set()` in `pin.service.js`:
   - Builds state `{ appid, name, pinnedAt, reason, sessionEndedAt: null, postsAccumulated: 0, lastRefreshedAt: null }`.
   - Persists to `pin.json` via plain `fs.writeFile`.
   - Starts the refresh timer (`PIN_REFRESH_INTERVAL_MS`, 20 min) and fires one refresh immediately.
3. `get()` returns `{ ...state, expiresAt }`, or `null` if expired (lazily clearing on read).

### Refresh timer
`_tick()` every 20 min while pinned: `refreshForPin(appid, name)` (reddit.service.js) fetches fresh posts; `recordRefresh(newCount)` adds to `postsAccumulated`. Reaching `PIN_MAX_POSTS` (200) clears the pin.

### Pin clear (session end)
1. `now-playing.service.js` calls `pin.clearIfPlaying()` on session end.
2. `clearIfPlaying()` only acts when `reason === 'playing'`; it stamps `sessionEndedAt` and starts the grace timer (`PIN_GRACE_MS`, 30 min). The refresh timer keeps running during grace.
3. After grace: `_clearState()` deletes `pin.json` and stops timers.
4. The pin also expires when 4 h have elapsed since `pinnedAt` (`PIN_MAX_DURATION_MS`) or `postsAccumulated ≥ 200`.

### Startup recovery
`startup()` reads `pin.json`. If expired, deletes it. Otherwise restores state, restarts the refresh timer, and resumes any remaining grace countdown. Wired in `boot.js` via `startScheduler('pin', startPin)` — gated by `ENABLE_SCHEDULERS` (the relay ran it unconditionally; now dev instances don't restart timers that would write the NAS).

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/pin/pin.service.js` | `set`, `clearIfPlaying`, `clear`, `recordRefresh`, `startup`, `get`, `_computeExpiresAt`, `_isExpired`, timers |
| `src/lib/server/relay/reddit/reddit.service.js` | `refreshForPin(appid, name)` — fetches Reddit posts for the pinned game |
| `src/lib/server/relay/steam/now-playing.service.js` | Calls `pin.set(..., 'playing')` / `pin.clearIfPlaying()` |
| `src/routes/relay/api/pin/+server.ts` | `GET /relay/api/pin` (204 when none), `DELETE /relay/api/pin` (hard unpin, 204) |
| `src/routes/relay/api/pin/[appid]/+server.ts` | `POST /relay/api/pin/:appid` — manual pin, body `{ name }` (`reason:'manual'`) |

Public base `/relay/api/…` (:8061), wrapped by `relayRoute('pin', …)`.

## Storage layout

`pin.json` lives at the data root itself (not a feature subdir): `relayDataRoot()/pin.json` (prod `/mnt/data-dir/gaming-journal/relay/pin.json`).

```
<relay-data-root>/
  pin.json   ← { appid, name, pinnedAt, reason, sessionEndedAt, postsAccumulated, lastRefreshedAt }
```

`expiresAt` is computed on read (`get()`), not stored.

## Common questions

**Q: What is `PIN_GRACE_MS`?**
After the session ends the pin stays active 30 min (default) so Reddit posts remain visible during the post-session summary. Env-overridable.

**Q: What does `PIN_MAX_DURATION_MS` (4 h) prevent?**
A hard cap: if a game is played past 4 h — or session-end is missed — the pin auto-expires at the 4-hour mark instead of lingering forever.

**Q: `reason` vs. the old `source` field?**
The state field is `reason` (`'playing'` for auto-pins, `'manual'` for the endpoint). `clearIfPlaying()` only auto-clears `reason === 'playing'`, so a manual pin survives session end.

## Gotchas

- `pin.json` is written with plain `fs.writeFile` (not ManagedFile) — no checkpoint, no atomic rename. `startup()` swallows a missing/corrupt file gracefully.
- `_refreshTimer` is a `setInterval` that runs while the pin is active; it's cleared in `_stopRefreshTimer()` (called from `_clearState()`).
- Both the grace timer and the refresh timer are re-established by `startup()` after a restart, so a mid-session process restart doesn't lose the pin.
```
