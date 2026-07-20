# Player Stats

Fetches per-game player statistics (kills, deaths, wins, etc.) from Steam's `GetUserStatsForGame` API. Stored in a single singleton JSON file keyed by appid. On-demand only — not on the 30-min tick.

## Data flow

1. `syncPlayerStats()` reads `getGames()` and filters to played games (`playtime_forever >= 1`).
2. Filters further (unless `force`): fetch if never cached, OR cache is stale (TTL 6h) AND `rtime_last_played * 1000 > fetchedAt`. Games unplayed since last fetch are skipped even when the cache is old.
3. Fetches `ISteamUserStats/GetUserStatsForGame/v2/` per candidate at 1 req/s. Errors silently skipped (`logger.debug`) — 400/403 is common.
4. Accumulates `updates = {}`, merges into the singleton: `statsFile.set({ ...statsFile.get(), ...updates })`.
5. Flushes only when updates exist.
6. `getPlayerStats()` returns `(await _loadStatsFile()).get()`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/stats.service.js` | `syncPlayerStats`, `getPlayerStats`, `_loadStatsFile` |
| `src/routes/relay/api/steam/stats/+server.ts` | `GET /relay/api/steam/stats` → `getPlayerStats()` (feature `steam-stats`) |
| `src/routes/relay/api/steam/stats/sync/+server.ts` | `POST /relay/api/steam/stats/sync?force=` — fire-and-forget `syncPlayerStats()` |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/
  player-stats.json   ← { [appid]: { fetchedAt, gameName, stats[] } }
```

`stats[]` entries: `{ name, value }` — raw from `GetUserStatsForGame`. Content varies by game.

## Gotchas

- Most games return 400/403 — the API is not universally supported. Failed fetches are silently skipped, not treated as errors (they increment `failed`, not `noStats`).
- An entry with `stats: []` is a valid cached result (game supports stats but tracks none). Same TTL — not re-fetched until 6h AND re-played.
- The `rtime_last_played` gate prevents re-fetching stats for games unplayed since the last check — stats only change when you play.
- The sync route has no overlap guard (kept verbatim from the relay controller).
