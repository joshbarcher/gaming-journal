# Reviews — Steam API

Fetches the user's own Steam reviews via the store `appreviews` API. Two modes: incremental search (3 pages, admin-triggered) and exhaustive scan (50 pages, admin-triggered). Shares the `reviews.json` singleton with the HTML scraper.

## Data flow

### Incremental sync (`syncReviews`)
1. Reads `getGames()`, filters to played games (`playtime_forever >= 1`).
2. Filters to games needing a check: no cached entry; OR cached `review === null` and older than `NULL_REVIEW_TTL_MS` (30 days); OR `rtime_last_played * 1000 > fetchedAt`.
3. `findUserReview()` calls `store.steampowered.com/appreviews/{appid}?json=1&filter=all` with cursor pagination, `num_per_page=100`, up to `MAX_REVIEW_SEARCH_PAGES = 3` pages (≈300 reviews), looking for the user's `steamid`.
4. Accumulates `updates = {}`, preserving `_scraperTs`. Merges into the singleton; flushes only if updates exist.

### Exhaustive scan (`scanReviews`)
1. Same candidate filter, but only games without a cached review; `findUserReviewExhaustive()` scans up to 50 cursor pages per game.
2. Writes each result immediately to the singleton, flushes at the end.

Neither runs on the 30-min tick — the tick calls the HTML scraper (`incrementalScrapeReviews`). Both are admin/route-triggered.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/steam.service.js` | `syncReviews`, `scanReviews`, `getReviews`, `getReview`, `getReviewsFile` (shared with scraper), `_loadReviewsFile` |
| `src/routes/relay/api/steam/reviews/+server.ts` | `GET /relay/api/steam/reviews` → `getReviews()` |
| `src/routes/relay/api/steam/reviews/[appid]/+server.ts` | `GET .../reviews/:appid` → `getReview()` |
| `src/routes/relay/api/steam/reviews/sync/+server.ts` | `POST .../reviews/sync?force=` — fire-and-forget `syncReviews` + `rebuild('account')` |
| `src/routes/relay/api/steam/reviews/scan/+server.ts` | `POST .../reviews/scan?force=` — fire-and-forget `scanReviews` + `rebuild('account')` |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/
  reviews.json   ← { [appid]: { fetchedAt, gameName, review, _scraperTs? } }
```

`review` is `null` (checked, not found) or the API review object: `voted_up`, `review`, `author`, `timestamp_created`, `votes_up`, `written_during_early_access`.
`_scraperTs` (day-precision unix ts) is set by the HTML scraper and preserved by `syncReviews`.

## Common questions

**Q: Why only 3 search pages (300 reviews)?**
The user's review is near the top of `filter=all` for recently-played games. `scanReviews` (50 pages) covers reviews buried deeper.

**Q: What is `NULL_REVIEW_TTL_MS` (30 days)?**
When no review is found, `review: null` is cached and only rechecked after 30 days (or an earlier replay) — avoids re-checking hundreds of unreviewed games every tick.

**Q: Why preserve `_scraperTs`?**
The scraper stores a day-precision HTML timestamp; the API returns an exact unix timestamp. Without `_scraperTs`, the scraper's day-level comparison against an API-exact `timestamp_created` would always mismatch and it would re-add the same review every tick.

## Gotchas

- `getReviewsFile()` is exported specifically so `scrape-reviews.service.js` shares the same in-memory singleton — both write via `{ ...get(), ...updates }` so last-writer-wins per key, neither drops the other's records.
- `rtime_last_played` is Unix seconds; comparisons multiply by 1000.
- The sync/scan routes are fire-and-forget (respond immediately, work continues in the background).
