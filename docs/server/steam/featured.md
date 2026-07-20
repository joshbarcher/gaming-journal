# Featured Games Poller

Hourly poller that fetches Steam's featured category sections and accumulates a weekly history of featured items. Feeds the Discover page. Lives in `src/lib/server/relay/steam/featured-poller.js` + `featured-history.service.js`.

## Data flow

1. `startPoller()` (from `boot.js` behind the `featured` scheduler) calls `load()`, warms discovery images from history, then runs one poll and sets an hourly `setInterval` (`POLL_MS`, 1h). The scheduler wraps polls in `tracked('steam:featured', ...)`.
2. `_poll()` fetches `store.steampowered.com/api/featuredcategories?cc=us&l=english`.
3. Extracts 4 sections (`new_releases`, `top_sellers`, `coming_soon`, `specials`); each item normalized via `_normalize()` → `{ appid, name, headerImage, posterImage, price, originalPrice, discount, isFree }`.
4. `accumulate(sections)` merges into the in-memory history and flushes the current week's file. Returns `{ created, refreshed }` (`refreshed` = already-seen items whose `lastSeen` bumped; only `created` is charted as new).
5. `ensureDiscoveryImages(pollItems)` downloads poster/header for this poll's items; confirmed posters are passed to `markPostersSynced()`.
6. Specials that rotated off the list (vs `_lastSpecialIds`) get a live price check via `_checkDiscount(appid)` → `markSaleActive()` (still on sale) or `markSaleEnded()` (confirmed over).

### History persistence
- One file per ISO week (Monday, UTC): `featured-YYYY-MM-DD.json`, written directly under the `steam/` dir.
- In-memory: one `Map` per tab, plus pre-sorted arrays (`specials` shows active sales only). `getAllPaged`/`getTabPaged` page 24 per page; `getAllItems()` returns the merged unique-item view for image warming.
- One-time migration: a legacy monolithic `featured-history.json` is split into weekly files and renamed to `.migrated`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/featured-poller.js` | `startPoller`, `pollOnce`, `_poll`, `_normalize`, `_checkDiscount`, `_lastSpecialIds` |
| `src/lib/server/relay/steam/featured-history.service.js` | `load`, `accumulate`, `markSaleEnded`, `markSaleActive`, `getAllItems`, `getAllPaged`, `getTabPaged`, weekly-file + migration logic |
| `src/lib/server/relay/steam/images.service.js` | `ensureDiscoveryImages` — poster/header downloads for featured appids |
| `src/routes/relay/api/discover/featured/+server.ts` | `GET /relay/api/discover/featured?tab=&page=` (`relayRoute('discover')`) via `discover.service.getFeatured` |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  featured-YYYY-MM-DD.json   ← weekly snapshot: { new_releases:{appid:entry}, top_sellers:{…}, coming_soon:{…}, specials:{…} }
```

Each `entry`: `{ item, firstSeen, lastSeen }`; specials additionally carry `saleEnded` + `verifiedAt`.

## Common questions

**Q: Where are the weekly files — a `featured/` subdir?**
No. `_historyDir()` returns the `steam/` feature dir, so `featured-*.json` sit alongside `games.json` etc.

**Q: What does the Discover `featured` route return?**
Sections/items with image URLs rewritten to `/relay/images/steam/games/{appid}/…` relay paths (poster falls back to header when no local poster). Adult flags are annotated; image caching continues in the background after the response.

## Gotchas

- `_lastSpecialIds` is module-level and resets on restart; the first post-restart poll treats all current specials as "new". Harmless (`markSaleActive` is idempotent).
- The poller runs its own hourly `setInterval` — it is NOT part of the 30-min steam tick.
- `_checkDiscount` makes a live `appdetails` price call before `markSaleEnded`, preventing false "ended" signals when the featured API temporarily omits an item.
