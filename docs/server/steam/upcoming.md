# Upcoming Games Cache

In-memory cache of library/wishlist games with a future or coming-soon release date. Built from locally-cached store data — no external API calls.

## Data flow

1. `build()` fires at boot (`bootRelay()` calls `buildUpcomingCache()` unconditionally as a fast-boot cache load) and again via `rebuild('upcoming')` on the 30-min tick.
2. Reads `games.json` + `wishlist.json` (direct `fs.readFile`, not singletons), unions their appids.
3. For each appid, reads `store/{appid}.json`. Included if `release_date.coming_soon === true` OR a parseable release date exists.
4. Results sorted by release date and split into `_cache = { upcoming, releases }`:
   - `upcoming` = coming-soon or release date ≥ today.
   - `releases` = every entry with release data (past and future).

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/upcoming.service.js` | `build`, `get` (upcoming), `getAll` (releases), `parseReleaseDate` |
| `src/lib/server/relay/boot.js` | `buildUpcomingCache()` at boot; `rebuild('upcoming')` runs on the tick |
| `src/routes/relay/api/steam/upcoming/+server.ts` | `GET /relay/api/steam/upcoming` → `get()` |
| `src/routes/relay/api/steam/releases/+server.ts` | `GET /relay/api/steam/releases` → `getAll()` |

## Storage layout

No dedicated storage — reads `games.json`, `wishlist.json`, and per-game `store/{appid}.json` under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

## Common questions

**Q: Does this require store data?**
Yes. A game with no `store/{appid}.json` won't appear even if it's genuinely unreleased — store data must be fetched (discovery pipeline or store sync) first.

**Q: `get()` vs `getAll()`?**
`get()` returns only future/coming-soon entries (`{ upcoming }`); `getAll()` returns all release-dated entries (`{ releases }`), backing `/relay/api/steam/releases`.

## Gotchas

- `build()` reads `games.json`/`wishlist.json` via direct `fs.readFile`, so it sees last-flushed disk state, not in-memory singleton state — fine because it runs at boot and on the tick after those files are flushed.
- `rebuild('upcoming')` re-reads every store file from disk — a full rebuild, not incremental.
- `get()`/`getAll()` return an empty-shaped object (`{ upcoming: [] }` / `{ releases: [] }`) before the first build completes.
