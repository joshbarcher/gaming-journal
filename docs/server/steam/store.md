# Steam Store Data

Fetches and caches per-game store-page data from the Steam store API (plus SteamSpy tags). On-demand — not on the 30-min tick. Used by the game detail page, wishlist cache, upcoming cache, and discovery pipeline.

## Data flow

1. `syncGameDetails()` reads `games.json` (+ wishlist appids), and for each: if cached and `SKIP_FIELDS` all present (or an `unavailable` sentinel), skip; else `fetchAppDetail()` calls `store.steampowered.com/api/appdetails?appids={appid}` at 1 req/s.
2. Response trimmed to `KEEP_FIELDS` via `pruneAppDetail()`, written to `store/{appid}.json`.
3. `success:false` over existing good data is treated as a throttle (preserved), not a delisting; only a `success:false` with nothing cached writes the `{ unavailable: true }` sentinel.
4. `syncTags()` / `syncOne()` patch missing tags from `steamspyFetch()` (`steamspy.com/api.php?request=appdetails`), with exponential backoff + `Retry-After` on 429 (up to 4 retries).
5. `getGameDetail(appid)` returns the cached file; `getGameDetailIndex()` builds a slim index of all cached files.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/store.service.js` | `syncGameDetails`, `syncOne`, `syncTags`, `recheckAppDetail`, `getGameDetail`, `getGameDetailIndex`, `steamspyFetch`, `KEEP_FIELDS`, `SKIP_FIELDS` |
| `src/routes/relay/api/steam/store/details/[appid]/+server.ts` | `GET .../store/details/:appid` → `getGameDetail()` (404 if not cached) |
| `src/routes/relay/api/steam/store/details/+server.ts` | `GET .../store/details` → index |
| `src/routes/relay/api/steam/store/details/sync/+server.ts` | `POST .../store/details/sync?force=` — fire-and-forget `syncGameDetails` + `rebuild('games','upcoming','wishlist')` |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/
  store/
    {appid}.json   ← trimmed store response (name, type, tags, description, metacritic,
                     release_date, screenshots, price_overview, genres, …) or { unavailable: true }
```

## Common questions

**Q: What triggers a store fetch?**
The discovery pipeline, the wishlist cache builder, the upcoming cache, and `POST .../store/details/sync`. Never re-fetched on a schedule — once a file has the `SKIP_FIELDS` core, it stays until forced or deleted.

**Q: What is SteamSpy used for?**
Tag/genre data that supplements the official API. No auth, but rate-limited (429) — `steamspyFetch` retries with backoff.

## Gotchas

- SteamSpy returns HTTP 200 with an empty body for unknown appids — `steamspyFetch` detects a missing `appid` field and throws.
- `KEEP_FIELDS` strips heavy fields to bound file size; add to it if a new consumer needs a stripped field. `SKIP_FIELDS` (a smaller core) decides "already cached" so growing `KEEP_FIELDS` doesn't force a re-sync of every file — use `force=true` to refresh.
- `syncOne` swallows `steamFetch` throws (e.g. 403) as "no data" so an async handler can't crash the process.
