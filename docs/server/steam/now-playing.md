# Now Playing

Polls Steam every 60s to detect the currently-running game, manages session open/close via the play-log, and tracks achievement baselines + mid-session unlocks. Lives in `src/lib/server/relay/steam/now-playing.service.js`. Started from `boot.js` (`now-playing` scheduler) after `loadPlayLog()`.

## Data flow

### Session start (`_openNewSession`)
1. `poll()` calls `GetPlayerSummaries/v2/` and reads `player.gameid`. Software-flagged appids (`isSoftware`) are treated as not-playing.
2. On a positive game change: `openSession(appid, name, now)` (play-log, persisted) and `pin.set(appid, name, 'playing')`.
3. Async: `fetchPlayerAchievementsNow(appid)` captures the baseline (`Set<apiname>` already unlocked); persisted to the open session via `patchOpenSession({ achievementsAtStart })`. An empty fetch = failure (not zero achievements) → baseline left `null` for a later mid-session retry.
4. `syncAchievementsForGame(appid, name)` ensures the schema is cached (fetches for brand-new games).
5. `rebuild('account')` so the home page reflects the session immediately.

### Mid-session (every 5 min, `ACH_POLL_INTERVAL_MS`)
- `fetchPlayerAchievementsNow(curr)`; if the baseline was never captured, seize the first good read as baseline. Diff against baseline → `_achDuring`. New unlocks trigger `refreshPlayerAchievements(appid)` and `patchOpenSession({ achievementsDuring })`. Empty/partial reads never shrink tracked progress.

### Session end (`_closeCurrentSession`)
- A final `fetchPlayerAchievementsNow(prev)` catches end-of-session unlocks (only trusted if non-empty, never shrinks below `_achDuring`). `closeSession(prev, endedAt, finalAchs)` persists the record; `pin.clearIfPlaying()`; `rebuild('account')`.

### Absence debouncing (the restart-flap fix)
- A single empty presence poll does NOT close an open session. `_missCount` increments; the session only closes after `NOW_PLAYING_CLOSE_MISSES` (env, default 3 ≈ 3 min) consecutive empty polls, and `endedAt` is backdated to the FIRST miss so durations stay accurate.
- A positive game *switch* (Steam reporting a different game) closes immediately — that signal is trusted.
- Poll *errors* (network/5xx) never touch session state; only a successful empty response counts toward the miss threshold.

### Restart recovery (`startPoller`)
- Reads `getOpenSession()`. If a session was open, restores `_cache`, `_sessionStart`, `_achBaseline`, `_achDuring`. If the game is still running the first poll is a no-op; if presence is transiently empty the debounce holds it open.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/now-playing.service.js` | Poll loop, `_cache`, `_achBaseline`, `_achDuring`, miss debounce, `startPoller`, `stopPoller`, `get` |
| `src/lib/server/relay/steam/play-log.service.js` | `openSession`, `closeSession`, `patchOpenSession`, `getOpenSession`, `clearOpenSession` |
| `src/lib/server/relay/steam/steam.service.js` | `fetchPlayerAchievementsNow`, `refreshPlayerAchievements`, `syncAchievementsForGame` |
| `src/lib/server/relay/pin/pin.service.js` | `set`, `clearIfPlaying` |
| `src/routes/relay/api/steam/now-playing/+server.ts` | `GET /relay/api/steam/now-playing` (`relayRoute('now-playing')`) |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  sessions/
    {appid}.json   ← { name, baseline, openSession, sessions[] }  (per-game play-log)
```

`openSession`: `{ startedAt, achievementsAtStart[], achievementsDuring[] }`. Closed `sessions[]` entries: `{ startedAt, endedAt, durationMin, achievements[] }` (pruned to a 30-day retention window on close).

## Common questions

**Q: How does `get()` show live elapsed time?**
`get()` returns `{ playing: { appid, name, sessionStartedAt, achievementsDuring } | null }`. The client computes elapsed time from `sessionStartedAt`; the relay does not tick a timer.

**Q: Why are software-flagged apps ignored?**
Utilities (Wallpaper Engine, etc.) can appear as `gameid`; `isSoftware(flags, appid)` filters them so they don't open false sessions.

## Gotchas

- Poll interval 60s, achievement poll 5 min — an unlock in the final 60s may be caught only by the end-of-session snapshot.
- `_cache`, `_sessionStart`, `_achBaseline`, `_achDuring`, `_missCount` are module-level; a restart clears them and they are restored from the open session.
- Play-log writes are fire-and-forget from the poll loop (`.catch()` only); a flush failure is logged, not fatal.
- `poll` is exported as `_pollOnce` purely as a test seam.
