# Community Reviews

Fetches up to 100 top English reviews per game from the Steam store reviews API. Per-game files plus an in-memory summary index (persisted to a sidecar for fast boot). Used by the game detail page to show community sentiment. Lives in `src/lib/server/relay/community-reviews/community-reviews.service.js`.

## Data flow

1. `boot()` at startup loads the persisted `community-reviews-index.json` sidecar in one read (`createPersistedIndex`), then background-refreshes. `boot.js` calls it as `bootCommunityReviews()`.
2. `syncGame(appid, { force })` reads the cached per-game file; `shouldSkip()` applies the TTL tier.
3. If not skipped: Call 1 is an unfiltered summary (`filter=all&language=all&num_per_page=0`) → `totalReviews`, `totalPositive`, `totalNegative`, `review_score_desc`. A `success:1` response missing `query_summary` is treated as transient — the cached entry is kept, not overwritten.
4. If `totalReviews > 0`: Call 2 fetches the top 100 English reviews (`filter=top&language=english&num_per_page=100&filter_offtopic_activity=1`).
5. Each review shaped via `shapeReview()`; entry written to `steam/community-reviews/{appid}.json`. `syncGame` returns `{ appid, totalReviews, reviewCount, isNew, hasChanged }` (or `{ skipped: true }`).
6. `syncAll({ force, onProgress })` iterates owned games + wishlist appids, paced ~1 req/s per call (1500–2000ms between fetched games, 3s after a failure).

### TTL tiers (`shouldSkip`)
- `reviewCount >= 100` (`TARGET_REVIEWS`) → satisfied, never re-fetch
- `totalReviews === 0` → recheck every 60 days (`RECHECK_EMPTY_MS`)
- `totalReviews < 10` (`SPARSE_THRESHOLD`) → recheck every 30 days (`RECHECK_SPARSE_MS`)
- otherwise → recheck every 7 days (`RECHECK_NORMAL_MS`)

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/community-reviews/community-reviews.service.js` | `syncGame`, `syncAll`, `shouldSkip`, `shapeReview`, `getEntry`, `boot`, `build`, `getIndex`, `ensureIndex` |
| `src/routes/relay/api/steam/community-reviews/+server.ts` | `GET /relay/api/steam/community-reviews` — summary index (`relayRoute('community-reviews')`) |
| `src/routes/relay/api/steam/community-reviews/[appid]/+server.ts` | `GET .../[appid]` — full entry; `POST .../[appid]/sync`; `POST .../sync` (all games) |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  community-reviews/
    {appid}.json                 ← { appid, checkedAt, totalReviews, reviewCount, summary, reviews[] }
  community-reviews-index.json   ← persisted summary sidecar (outside the per-game dir)
```

`summary`: `{ totalPositive, totalNegative, scoreDesc, ratio }`. `reviews[]`: up to 100 shaped `{ id, votedUp, postedAt, hoursAtReview, hoursTotal, votesUp, votesFunny, commentCount, earlyAccess, text }`.

## Common questions

**Q: Recent or top reviews?**
Call 2 uses `filter=top` (Steam's "most helpful"), English-only, off-topic review-bombs filtered out (`filter_offtopic_activity=1`). The summary (Call 1) counts all languages.

**Q: How is the index kept fast at boot?**
The summary array is persisted to `community-reviews-index.json`; `boot()` loads that sidecar instead of re-scanning every per-game file. `build()` does a full rescan + re-persist; it is registered with `cache-manager` for post-sync refresh.

## Gotchas

- Games with `reviewCount >= 100` are permanently skipped, even if new reviews are posted.
- The sidecar lives outside the per-game `community-reviews/` dir so the rebuild scan never picks it up.
- A per-game entry is only rewritten when `totalReviews` actually changed (`hasChanged`) or on first sight (`isNew`).
