# Player Counts

Tracks current player counts over time for owned/wishlisted games plus the Steam global top ranks. Time-series with automatic compaction. Collected on the 30-min steam tick as part of the snapshot sequence.

## Data flow

### Collection (on the tick)
1. `collectOwned()` reads `games.json` + `wishlist.json`, fetches `ISteamUserStats/GetNumberOfCurrentPlayers/v1/` per appid (concurrency 5), appends `[unixSec, count]` samples to `player-counts.json`.
2. `collectGlobalTop()` fetches ranks from `ISteamChartsService/GetMostPlayedGames/v1/`, then a real-time `GetNumberOfCurrentPlayers` per ranked appid (the cached `concurrent_in_game` from GetMostPlayedGames is only refreshed ~daily). New/unnamed appids are enqueued for discovery.
3. Both run `_compactAll(data)` then atomically `_saveAll()` (tmp + rename).
4. `rebuild('player-counts')` rebuilds the sorted in-memory `_index`.

### Compaction (before each save)
- 0–30 days → raw 30-min samples
- 30 d–1 year → 6-hour bucket averages
- \> 1 year → dropped

### Cache build (`build` / `ensureBuilt`)
Auto-migrates the legacy per-file store on first run, loads `player-counts.json` into `_data`, builds `_index` (latest, peak24h/7d/allTime, samples24h, owned/wishlisted/filtered flags). Boot-wired via `startScheduler('player-counts-cache', build)`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/player-counts.service.js` | `collectOwned`, `collectGlobalTop`, `build`, `ensureBuilt`, `getIndex`, `getHistory`, `getFiltered`, `addFiltered`, `removeFiltered`, `patchName` |
| `src/lib/server/relay/steam/sessions.service.js` | Calls `collectOwned` + `collectGlobalTop` each tick |
| `src/routes/relay/api/player-counts/*` | `GET /` (index), `GET /top`, `GET /:appid`, `GET /filtered`, `POST /collect`, `GET|POST /filtered/:appid` |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/
  player-counts.json   ← { [appid]: { name, peakAllTime, samples: [[unixSec, count], ...] } }
  player-counts/
    filtered.json      ← server-side mute list (appids); rest of dir is legacy backup
```

## Common questions

**Q: Where are the HTTP endpoints?**
Top-level `/relay/api/player-counts` (not under `/steam`). `POST /collect` answers immediately and runs collection + rebuild in the background, 409 while already collecting.

**Q: Why is `getHistory` synchronous but the route awaits it?**
It reads the in-memory `_data` — no per-request file read. `ensureBuilt()` populates the store on the first request until boot wiring covers it.

## Gotchas

- `_loadAll()` distinguishes ENOENT (fresh `{}`) from a read error (throws to protect months of history) — returning `{}` on a transient error and saving would wipe every game's samples.
- Compaction runs on every save (`_compactAll` iterates all entries) — bounded file size at a few ms CPU.
- `peakAllTime` is the lifetime max, updated whenever a new sample (or a global-top `peak_in_game` hint) exceeds it.
- The `player-counts/` directory is legacy backup from the per-file→consolidated migration; only `filtered.json` is still live there.
