# 30-Minute Sync Tick

`startSnapshotScheduler()` in `steam/sessions.service.js` is the central periodic job driving most Steam data refresh. `boot.js` starts it (Wave 4) behind `ENABLE_SCHEDULERS`. It fires every 30 min and runs a fixed sequence in order. Each step is wrapped in `tracked(<id>, fn)` (`metrics/sync-metrics.service.js`) so runs record into `metrics/journal/` for the dashboard.

## Data flow

### Scheduler startup
1. `boot.js` calls `startScheduler('sessions', startSnapshotScheduler)` (prod only).
2. `startSnapshotScheduler()` pre-loads the `playtime-snapshots.json` and `sessions.json` singletons (`Promise.all`) so the first tick doesn't stall on a cold load.
3. First tick delayed **60 s** (`setTimeout(tick, 60_000)`); subsequent ticks every **30 min** (`SNAPSHOT_INTERVAL_MS`, `setInterval`).

### Per-tick sequence (ordered; a step failure is caught + logged, tick continues)
```
1.  tracked('steam:sessions')      takeSnapshot() → deriveSessions()   (SESSION_GAP_MS gap detection)
2.  tracked('steam:library')       syncRecentlyPlayed()                (1h TTL)
3.  rebuild('account')             in-memory account cache
4.  tracked('steam:player-counts') collectOwned()
5.  tracked('steam:player-counts') collectGlobalTop()
6.  rebuild('player-counts')
7.  tracked('steam:reviews')       incrementalScrapeReviews()          (1-page stop-early scrape)
8.  getKnownAppids() → prevIds     snapshot appid set before syncGames
9.  tracked('steam:library')       syncGames()                         (refresh games.json if >24h stale)
10. cleanupLocalWishlist()         drop wishlist items no longer owned
11. tracked('steam:library')       syncWishlist()                      (refresh wishlist.json if stale)
12. provisionNewGames(prevIds)     ITAD + HLTB + images for appids new since step 8
13. recheckUnavailableWishlistItems()  retry ITAD for previously-unavailable items
14. rebuild('wishlist','games','upcoming')
15. tracked('steam:achievements')  syncAchievements() → syncedAppids
16. if syncedAppids.length:
    tracked('steam:images')        syncAchievementImages({ appids })   (icons for just-synced games only)
```
Steps 2/9/11 all record under `steam:library`; the `tracked` counter only counts a "new" record when the store was actually re-fetched AND an appid appeared (`countIfRefetched`/`countNewIds`), so a stale-skip or an unchanged list records 0.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/sessions.service.js` | `startSnapshotScheduler`, `takeSnapshot`, `deriveSessions`, the `tick()` |
| `src/lib/server/relay/steam/steam.service.js` | `syncGames`, `syncWishlist`, `syncRecentlyPlayed`, `syncAchievements` |
| `src/lib/server/relay/steam/scrape-reviews.service.js` | `incrementalScrapeReviews` |
| `src/lib/server/relay/steam/images.service.js` | `syncAchievementImages` (reads the sharded achievement cache) |
| `src/lib/server/relay/steam/player-counts.service.js` | `collectOwned`, `collectGlobalTop` |
| `src/lib/server/relay/provision.service.js` | `getKnownAppids`, `provisionNewGames`, `recheckUnavailableWishlistItems`, `cleanupLocalWishlist` |
| `src/lib/server/relay/shared/cache-manager.js` | `rebuild` — invalidates + rebuilds named in-memory caches |
| `src/lib/server/relay/metrics/sync-metrics.service.js` | `tracked` — records each step into `metrics/journal/` |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay/`):
```
steam/
  playtime-snapshots.json   ← { snapshots: [{ takenAt, games[] }] } — 30-day rolling window
  sessions.json             ← { [appid]: { name, sessions[] } } — derived from snapshots
metrics/journal/            ← per-run tick records (runs-YYYY-MM.json)
```

## Common questions

**Q: Why delay the first tick 60 s?**
The tick does heavy Steam API work; running it before the server binds + finishes fast-boot cache loads can make startup look slow/unhealthy.

**Q: How does `provisionNewGames` know which games are new?**
`getKnownAppids()` (step 8) captures the appid set before `syncGames()` writes; `provisionNewGames(prevIds)` diffs the new list against it.

**Q: What if `syncAchievements` syncs 0 games?**
Step 16 is skipped (`syncedAppids.length > 0` guard) — no no-op image sync.

## Gotchas

- `rebuild('wishlist','games','upcoming')` must rebuild `games` alongside `wishlist`: poster-pool wishlist tagging reads the `games` cache, so a frozen `games` cache silently starves the Home mosaic's wishlist pool.
- `deriveSessions()` writes `sessions.json` every tick (no audit/change-detection there) — always overwritten.
- Snapshot retention is 30 days; older snapshots pruned in `takeSnapshot()` before the new one is appended.
- The whole sequence runs serially in one `tick()`. If a step runs 30+ min the next tick could overlap; in practice it finishes well within the interval.
