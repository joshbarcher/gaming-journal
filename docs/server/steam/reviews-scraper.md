# Reviews — HTML Scraper

Scrapes the user's Steam Community reviews page to pick up new/updated reviews. Runs on the 30-min tick (incremental) and on-demand (full). Shares the `reviews.json` singleton with the Steam API review service.

## Data flow

### Incremental scrape (on the tick)
1. `incrementalScrapeReviews()` requires `STEAM_VANITY_URL` — returns `{ added: 0 }` silently if unset.
2. Fetches `steamcommunity.com/id/{vanity}/reviews?p={page}` starting at page 1.
3. `parseReviewsPage()` splits `review_box` blocks; `parseReviewBlock()` extracts `appid`, `voted_up`, `review`, `timestamp_created` (day-precision), `votes_up`, `playtime_at_review`.
4. Stops paginating at the first review already cached (compares `_scraperTs` + `voted_up`). In steady state: 1 HTTP request, 0 writes.
5. New reviews accumulated into `updates`, merged into the singleton (`{ ...get(), ...updates }`), flushed with `_scraperTs = review.timestamp_created`.

### Full scrape (`scrapeUserReviews`, manual)
1. Parses total from "Showing 1-10 of N entries" for page count, paginates all pages (1.5 s delay).
2. Runs `detectDrift()` per page — warns if selectors look broken.
3. Writes each page's results to the singleton, flushes at end.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/scrape-reviews.service.js` | `incrementalScrapeReviews`, `scrapeUserReviews`, `parseReviewBlock`, `parseReviewsPage`, `parseTotalEntries`, `detectDrift` |
| `src/lib/server/relay/steam/steam.service.js` | `getReviewsFile()` (shared singleton), `getGames()` for name lookup |
| `src/routes/relay/api/steam/reviews/scrape/+server.ts` | `POST /relay/api/steam/reviews/scrape?force=` — fire-and-forget `scrapeUserReviews` + `rebuild('account')` |

## Storage layout

Shares `reviews.json` with the API review service — see `reviews-api.md`. Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/
  reviews.json   ← { [appid]: { fetchedAt, gameName, review, _scraperTs } }
```

## Common questions

**Q: Why share `reviews.json` with the API service?**
Both write the same per-game record. The shared singleton makes concurrent writes safe: each spreads into `get()` at merge time, so last-writer-wins per key without dropping records.

**Q: How does the incremental scraper know when to stop?**
Reviews are most-recent-first. When it hits a review whose `_scraperTs` and `voted_up` match the cache, everything after is older and cached — it stops. Steady state stops after the first review on page 1.

**Q: What does `detectDrift()` check?**
Missing appid (app-link selector), missing date ("Posted" format), empty text (content div), wrong per-page count (pagination). Returns warnings; never aborts.

## Gotchas

- `STEAM_VANITY_URL` must be set (`steamcommunity.com/id/{slug}`). Absent → silent no-op.
- The parser is regex-based, not a DOM parser — Steam HTML changes can silently break field extraction. Watch `detectDrift()` warnings.
- `scrapeUserReviews` also writes `_scraperTs` (`review.timestamp_created`), same as the incremental path.
- Page delay is 1.5 s (`PAGE_DELAY_MS`); a full scrape of 100+ reviews takes ~15 s minimum.
