# Steam Games Library

Fetches and caches the full list of owned Steam games. This is the canonical game list used throughout the relay code — achievements, reviews, recently played, images, and provisioning all filter or join against it. Lives in `src/lib/server/relay/steam/steam.service.js`.

## Data flow

1. `syncGames()` calls `IPlayerService/GetOwnedGames/v1/` with `include_appinfo=1` and `include_played_free_games=1`.
2. Empty-response guard: if the API returns 0 games over a non-empty cache (private profile / transient), the cache is kept and no write happens. The `games` ManagedFile also has a count-collapse audit that quarantines a write dropping a populated file to empty.
3. Otherwise written to the `games.json` singleton (`file.set()` → `flush()`), stamped with `gameCount` from the API's `game_count`.
4. `getGames()` returns `(await _loadGamesFile()).get()` — synchronous after first load. The loader caches the load *promise* to avoid a boot race between concurrent callers.
5. TTL gate is 24h (`GAMES_TTL_MS`); a fresh cache skips the API call.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/steam.service.js` | `syncGames`, `getGames`, `_loadGamesFile`, `GAMES_TTL_MS`, count-guard audit |
| `src/lib/server/relay/steam/sessions.service.js` | `startSnapshotScheduler` — the 30-min tick that calls `syncGames()` |
| `src/routes/relay/api/steam/games/+server.ts` | `GET /relay/api/steam/games` (`relayRoute('steam')`); `POST /relay/api/steam/games/sync` |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  games.json   ← { fetchedAt, gameCount, games[] }
```

Each `games[]` entry is the raw Steam API object — `appid`, `name`, `playtime_forever`, `rtime_last_played`, `has_community_visible_stats`, image-hash fields, etc.

## Common questions

**Q: When does `syncGames` run in the 30-min tick?**
`startSnapshotScheduler`'s `tick()` runs: snapshot+deriveSessions → `syncRecentlyPlayed` → `rebuild('account')` → player-counts collect + rebuild → review scrape → `syncGames` → `cleanupLocalWishlist` → `syncWishlist` → `provisionNewGames(prevIds)` → wishlist recheck → `rebuild('wishlist','games','upcoming')` → `syncAchievements` → achievement images. `syncGames` deliberately runs before `provisionNewGames`, which needs the fresh list to spot new appids. The tick's first run is delayed 60s after boot.

**Q: Does `syncGames` hit the API every tick?**
No — 24h TTL, so most ticks short-circuit on a fresh cache. `POST /relay/api/steam/games/sync?force=true` or `syncGames({ force: true })` bypasses it.

## Gotchas

- `getGames()` returns all owned games including zero-playtime. Callers wanting played games filter `g.playtime_forever >= 1`.
- `gameCount` comes from Steam's `game_count`; it can differ from `games.length` on an incomplete response.
- Free games are included; software apps appear too and are filtered downstream via `isSoftware(flags, appid)`.
