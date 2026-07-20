# IsThereAnyDeal (ITAD)

Fetches and caches current prices and historical lows from IsThereAnyDeal for all owned games and wishlist items. Per-game files, 72-hour sync scheduler, plus resolved (de-tracked) store URLs. Folded into the gaming-journal SvelteKit app.

## Data flow

### Full sync (`syncAll` → `syncGames`)
1. `getAllGames()` yields owned + wishlist appids.
2. Phase 1 `resolveMissingIds`: for each game without a cached `itadId`, calls `GET /games/lookup/v1?appid=`. Reuses the cache whenever `'itadId' in existing` (including a cached `null`). 100–300 ms jitter between lookups.
3. Phase 2: picks games whose `fetchedAt` is older than `ITAD_SYNC_INTERVAL_HOURS` (default 72 h), or `force`.
4. Phase 3: batches resolved ids (100 at a time) into `POST /games/prices/v2` + `POST /games/historylow/v1`. Ids in a batch that succeeds go into `fetchedOkIds`; a batch that throws leaves its ids out.
5. Phase 4 writes `itad/{appid}.json`. `filterAndSortDeals` keeps only the opt-in `STORES` (by numeric shop id), sorted by price ascending. Resolved URLs within the 14-day TTL are carried forward so redirects aren't re-followed every sync.
6. `resolveEntryUrls(appid)` runs right after each write (HEAD-follows deal redirects, strips tracking, stamps `resolvedAt`).
7. `rebuildIndex()` writes `itad/index.json` (best current deal per game).

### Off-sale vs. transient (persistence rule)
- **Successful batch, no deals** (game genuinely off sale): `filterAndSortDeals([])` → writes `deals: []` and re-stamps `fetchedAt`.
- **Failed batch** (429/5xx/network): `itadId` is absent from `fetchedOkIds`, so Phase 4 skips the game — the cached entry is carried forward untouched and `fetchedAt` is NOT re-stamped, so the next sync retries.

### Scheduler
- `startItadSyncScheduler()` — wired in `boot.js` via `startScheduler('itad', …)`, gated by `ENABLE_SCHEDULERS` (`SCHED_ITAD=off` disables). Sets a `setInterval` every `ITAD_SYNC_INTERVAL_HOURS` (default 72 h) — it does NOT run an immediate sync at startup. Also a weekly `verifyAll()` (HEAD each stored URL; clears `resolvedAt` on broken links).

### ID re-resolution (games too new / lookup failed)
`resolveMissingIds()` reuses a cached entry whenever `'itadId' in existing` — even `itadId: null` (a known "not on ITAD"). Phase 4 writes that `null` sentinel **only** when the API `confirmed` the miss (`confirmed && itadId === null && !existingEntries.has(appid)`). A **network-failed** lookup (`confirmed: false`) is therefore NOT written to disk, so `resolveMissingIds` retries it on the next `syncGames` — a too-new game resolves once ITAD lists it. (Steam-store *availability* rechecks for wishlist items are a separate concern, handled by `provision.service.js` `recheckUnavailableWishlistItems` — not ITAD.)

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/itad/itad.service.js` | `syncAll`, `syncOne`, `syncGames`, `getEntry`, `getIndex`, `startItadSyncScheduler`, `resolveAll`, `verifyAll`, `shapeDeal`, `shapeHistoricalLow`, `filterAndSortDeals`, `priceSignature`, `STORES` |
| `src/lib/server/relay/provision.service.js` | `provisionGame` calls `syncItadOne` (= `syncOne`) as step 3 |
| `src/routes/relay/api/itad/+server.ts` | `GET /relay/api/itad` — index |
| `src/routes/relay/api/itad/[appid]/+server.ts` | single entry |
| `src/routes/relay/api/itad/sync/+server.ts` | `POST` full sync (409 guard) |
| `src/routes/relay/api/itad/{stores,wishlist,resolve-urls,verify-urls}/+server.ts` | store list, wishlist view, URL maintenance |

Public base `/relay/api/…` (:8061), wrapped by `relayRoute('itad', …)`.

## Storage layout

`featureDir('itad')` = `relayDataRoot()` + `/itad` (prod `/mnt/data-dir/gaming-journal/relay/itad/`).

```
<relay-data-root>/itad/
  {appid}.json   ← { appid, steamName, itadId, fetchedAt, deals[], historicalLow }
  index.json     ← [{ appid, steamName, bestPrice, historicalLow, dealCount }]
```

`deals[]`: `{ store, storeId, price, regular, cut, url, resolvedAt? }` (filtered to `STORES`, sorted by price).
`historicalLow`: `{ price, cut, store, date }` or `null`.
`itadId: null` = sentinel: game not on ITAD; re-lookup is skipped because `'itadId' in existing`. (The stored file carries `itadId: null`, not a `confirmed` field — `confirmed` is an in-memory flag only.)

## Common questions

**Q: How is "not on ITAD" remembered?**
When `GET /games/lookup/v1` responds `found:false`, the in-memory result has `confirmed:true, itadId:null`; a sentinel file with `itadId: null` is written. Future syncs skip the lookup because the key exists. A network-error lookup is `confirmed:false` and is NOT cached, so it retries next sync.

**Q: Why is country configurable (`ITAD_COUNTRY`)?**
ITAD pricing is region-specific. Default `US`.

**Q: Which stores appear in `deals`?**
The `STORES` allow-list (numeric ITAD shop ids): Steam(61), GameBillet(20), Fanatical(6), Humble(37), GamesPlanet US/UK/DE/FR(29/26/27/28), GreenManGaming(36). Others are filtered out.

## Gotchas

- `ITAD_API_KEY` is required; every API call throws without it.
- `resolveMissingIds` looks up ids sequentially (not batched) to respect rate limits — an initial full resolve for a large library (1800+ games) can take minutes.
- `URL_RESOLVE_TTL_MS` (14 days) IS used: carry-forward in `syncGames`, the skip in `resolveEntryUrls`, and re-resolution of stale/new deals.
- `priceSignature` (deals sorted, ignores `url`/`resolvedAt`/`fetchedAt`) gates the `created`/`updated` novelty counts so re-stamping a URL doesn't chart ~2,000 fake "new records".
- `rebuildIndex()` runs once per `syncAll`/`syncOne` (after the loop) — not per game.
```
