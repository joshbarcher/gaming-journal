# Snapshot-Based Sessions

Derives play sessions from 30-minute playtime snapshots. Separate from the play-log (real-time open/close events) — this reconstructs session history from polling deltas for longer historical analysis. `startSnapshotScheduler()` here is also **THE 30-minute steam tick**.

## Data flow

### The 30-min tick (`startSnapshotScheduler` → `tick`)
First tick is delayed 60 s after boot, then every `SNAPSHOT_INTERVAL_MS` (30 min). Each tick, in order:
1. `takeSnapshot()` + `deriveSessions()` (below).
2. `syncRecentlyPlayed()`.
3. `rebuild('account')`.
4. `collectOwned()` + `collectGlobalTop()` (player-counts) then `rebuild('player-counts')`.
5. `incrementalScrapeReviews()` (HTML review scraper).
6. `syncGames()`, `cleanupLocalWishlist()`, `syncWishlist()`, `provisionNewGames()`, `recheckUnavailableWishlistItems()`, `rebuild('wishlist','games','upcoming')`.
7. `syncAchievements()` then `syncAchievementImages()` for the synced appids only.

### Snapshot (per tick)
1. `takeSnapshot()` calls `IPlayerService/GetRecentlyPlayedGames/v1/` (`count=0`) — cumulative `playtime_forever` for Steam's 2-week recency window.
2. Snapshots older than 30 days pruned, new one appended, written to `playtime-snapshots.json` via `file.set()` → `file.flush()`.

### Session derivation (`deriveSessions`)
1. Reads all snapshots (requires `>= 2`).
2. Per game, gathers chronological `{ takenAt, playtime }` observations.
3. If `delta > 0`, accumulates an active session; if `delta == 0` and gap `>= SESSION_GAP_MS` (90 min), closes and appends it.
4. Software apps (`isSoftware(flags, appid)`) skipped. Result rewritten to `sessions.json`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/sessions.service.js` | `takeSnapshot`, `deriveSessions`, `getSessions`, `getSnapshots`, `startSnapshotScheduler`, `stopSnapshotScheduler` |
| `src/lib/server/relay/boot.js` | `startScheduler('sessions', startSnapshotScheduler)` (gated `ENABLE_SCHEDULERS` + `SCHED_SESSIONS`) |
| `src/routes/relay/api/steam/playtime/sessions/+server.ts` | GET → `getSessions()` (feature `sessions`) |
| `src/routes/relay/api/steam/playtime/snapshots/+server.ts` | GET → `getSnapshots()` (raw 30-day history) |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/
  playtime-snapshots.json   ← { snapshots: [{ takenAt, games[] }] }
  sessions.json             ← { [appid]: { name, sessions[{ startedAt, endedAt, durationMin }] } }
```

`snapshots[]`: `{ takenAt: ISO, games: [{ appid, name, playtime_forever }] }`.
`sessions[]`: `{ startedAt, endedAt, durationMin }`.

## Common questions

**Q: How does `SESSION_GAP_MS = 90min` work?**
If playtime stops increasing for 90+ consecutive minutes, the current session ends. Gaps of 30/60 min (one or two idle ticks) keep it open. At 90 min the assumption flips to "session ended."

**Q: Difference from the play-log?**
`sessions.service.js` infers sessions from `playtime_forever` deltas — a 30-day historical record even across missed poller events. The play-log (`play-log.service.js`) records exact poller-detected start/stop, more precise but real-time.

**Q: Why are software apps filtered?**
`isSoftware(flags, appid)` skips non-game apps (e.g. Wallpaper Engine) that appear in recently-played but should not produce sessions.

## Gotchas

- `sessions.json` is rebuilt from scratch each tick from all 30 days of snapshots — never incrementally updated.
- A game only appears in new snapshots while Steam's 14-day recency window reports it; historical snapshots retain it until the 30-day window ages it out.
- `deriveSessions()` returns `{}` when `snapshots.length < 2`.
- Software apps are filtered at derive time, not snapshot time — they accumulate in `playtime-snapshots.json` but are excluded from `sessions.json`.
- The scheduler must be boot-wired (prod-only) — never started as an import side effect. `_resetForTests()` drops memoized ManagedFiles for tests.
