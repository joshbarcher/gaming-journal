# Steam Wishlist

Fetches and caches the Steam wishlist (raw priority/date), and builds a richer shaped wishlist (store + ITAD + flags) for the wishlist UI. Feeds the provision pipeline that detects new items needing HLTB/ITAD lookups.

## Data flow

### Raw sync (`steam.service.js`)
1. `syncWishlist()` calls `IWishlistService/GetWishlist/v1/`, indexes items by `appid` → `{ priority, date_added }`, writes `wishlist.json`. Guards against wiping a good wishlist when the API returns empty. TTL 24h.
2. Runs on the 30-min tick after `cleanupLocalWishlist()`, then `provisionNewGames(prevIds)` + `recheckUnavailableWishlistItems()`.

### Shaped cache (`wishlist/wishlist.service.js`)
1. `scanCache()` joins Steam + local wishlist items with `store/{appid}.json`, `itad/{appid}.json`, and journal `flags.json` into shaped entries (price, best deal, historical low, release, alert flag), priority-sorted.
2. Persisted to a `wishlist-index.json` sidecar via `createPersistedIndex` — `boot()` fast-loads it in one read, then refreshes in the background. `patchItem(appid)` re-shapes a single entry (4 file reads) and splices it into the live cache — a targeted delta, no full rescan.
3. `register('wishlist', build)` — rebuilt on the tick's `rebuild('wishlist', …)`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/steam.service.js` | `syncWishlist`, `getWishlist`, `_loadWishlistFile` |
| `src/lib/server/relay/wishlist/wishlist.service.js` | Shaped cache: `boot`, `build`, `ensureBuilt`, `get`, `patchItem`, `scanCache` |
| `src/lib/server/relay/provision.service.js` | `provisionNewGames`, `recheckUnavailableWishlistItems`, `cleanupLocalWishlist`, `getKnownAppids` |
| `src/routes/relay/api/steam/wishlist/+server.ts` | `GET .../steam/wishlist` → raw `getWishlist()` |
| `src/routes/relay/api/wishlist/+server.ts` | `GET /relay/api/wishlist` → shaped `get()` (feature `wishlist`) |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`), except the two journal-owned files noted below.

```
<relay-data-root>/steam/
  wishlist.json         ← { fetchedAt, itemCount, items: { [appid]: { priority, date_added } } }
  wishlist-index.json   ← shaped-cache sidecar (fast boot)

$DATA_DIR/gaming-journal/
  local-wishlist.json   ← journal-owned local (non-Steam) wishlist items
  flags.json            ← journal-owned per-game flags (e.g. price alert)
```

## Common questions

**Q: `wishlist.json` vs the shaped cache?**
`wishlist.json` is raw Steam data (priority + date_added). `wishlist/wishlist.service.js` joins it with store/ITAD/flags into the rich cache served at `/relay/api/wishlist`.

**Q: What does `cleanupLocalWishlist` do?**
Runs before `syncWishlist()`; removes derived data (ITAD/store) for games no longer on the wishlist so stale data doesn't accumulate.

**Q: When are new wishlist items provisioned?**
After `syncWishlist()`, `provisionNewGames(prevIds)` diffs against the previous appid set and queues ITAD + HLTB + image fetches for new appids.

## Gotchas

- `wishlist.json` items are keyed by numeric appid; some lookups need `String(appid)`.
- `recheckUnavailableWishlistItems()` retries ITAD resolution for items ITAD couldn't resolve — coverage improves over time.
- `local-wishlist.json` and `flags.json` are journal-owned and stay under `$DATA_DIR/gaming-journal/`, not the relay data root.
- `patchItem` no-ops until the shaped cache is loaded (a full build covers it); reads are served via `ensureBuilt()` until boot wiring lands.
