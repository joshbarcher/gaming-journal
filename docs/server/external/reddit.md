# Reddit

Fetches Reddit posts and comments for a game's community feed. Uses the shared
stealth Puppeteer browser (`browser/browser.service.js`) to reach Reddit's `.json`
endpoints. Mirrors post images/videos locally. Discovers the game subreddit via
IGDB. Posts **accumulate** across syncs (feeds grow, not replaced).

## Data flow

### On-demand / pin / daily sync (`syncGame`)
1. `syncGame(appid, gameName, { force })` (in-flight guarded per appid) resolves the
   subreddits to crawl:
   - IGDB game subreddit via `getSubreddit(appid, gameName)`
   - user overrides from `$DATA_DIR/gaming-journal/reddit-subreddits.json`
     (journal-owned; read best-effort)
   - `r/pcgaming` and `r/games`, searched by game name
2. Each subreddit is pulled across four sort listings — `hot`, `new`, `top` (week),
   `controversial` (week) — deduped and **merged** into the cached feed (`mergePosts`,
   newest-first, capped at `MAX_STORED_POSTS = 200`).
3. Posts filtered/shaped by `reddit.filter.js` (`shouldInclude`, `shapePost`); media
   for genuinely-new posts is mirrored (images, video posters; Imgur URLs resolved
   via `imgur.service.js`).
4. Entry written to `reddit/{appid}.json`. User-override subs are stored as **shared**
   sources (`reddit/subreddits/{sub}.json`) referenced by the entry.
5. Opening a post fetches its comment thread + full media via
   `fetchAndCacheThread` → `reddit/comments/{appid}/{postId}.json`.
6. TTL 6 h — a `syncGame` within the window returns cached data (a partial sync still
   runs if new user subs were added).

### Schedulers / triggers
- **Daily background sync**: `startRedditSyncScheduler()` (from `bootRelay()` behind
  `startScheduler('reddit', …)`, after `startBrowser()`). `REDDIT_SYNC_INTERVAL_HOURS`
  default 24, 5-min startup delay. Targets games played in the last 21 days or flagged
  in-progress (`_dailySyncTargets`), force-synced with 30–60 s gaps.
- **Pin refresh**: `pin.service.js` calls `refreshForPin(appid, gameName)` every
  `PIN_REFRESH_INTERVAL_MS` (20 min) while a game is pinned — a forced re-fetch that
  stamps `mergedAt` and returns the new-post count.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/reddit/reddit.service.js` | `syncGame`, `refreshForPin`, `runDailySync`, `startRedditSyncScheduler`, `fetchAndCacheThread`, `mergePosts`, media caching, SSE progress |
| `src/lib/server/relay/browser/browser.service.js` | Shared stealth browser (`startBrowser`, `closeBrowser`, `browserGet`) — Reddit re-exports the first two |
| `src/lib/server/relay/reddit/reddit.filter.js` | `shouldInclude`, `shapePost`, `shapeComment` |
| `src/lib/server/relay/imgur/imgur.service.js` | `resolveImgurUrl` (gallery/redirect → direct image) |
| `src/lib/server/relay/igdb/igdb.service.js` | `getSubreddit` — game subreddit discovery |
| `src/routes/relay/api/reddit/**` | `GET /[appid]` (`?name=` on-demand), `POST /[appid]/sync` (409-guarded), `GET /[appid]/sync/progress` (SSE), `GET /[appid]/thread/[postId]`, `POST /validate-subreddit` |

## Storage layout

All paths relative to `RELAY_DATA_ROOT` (prod `/mnt/data-dir/gaming-journal/relay/`):

```
reddit/
  {appid}.json                     ← { appid, gameName, subreddit, fetchedAt, mergedAt?, sources[] }
  comments/{appid}/{postId}.json   ← { post, comments[] }
  images/{appid}/…                 ← post/thumb/gallery/comment/imgur images
  videos/{appid}/…                 ← post videos + Giphy MP4s
  subreddits/{sub}.json            ← shared (user-subscribed) subreddit feed
  images/subreddits/{sub}/…        ← images for shared subs
  videos/subreddits/{sub}/…        ← videos for shared subs
```

Images served at `/relay/images/reddit/*` (WebP sidecar via `serveWithWebp`); videos
at `/relay/videos/reddit/*` (range-capable `serveStatic`). Route handlers:
`src/routes/relay/images/reddit/[...file]/+server.ts`,
`src/routes/relay/videos/reddit/[...file]/+server.ts`.

## Gotchas

- The shared browser is started in `bootRelay()` (behind schedulers) and closed on
  shutdown; its closer is also registered **unconditionally** since an on-demand
  sync can lazily launch Chrome. `browserGet` re-warms and retries when Reddit
  returns HTML (bot detection) instead of JSON.
- A failed per-source fetch **reuses the last-good source block** rather than
  dropping it — a transient bot-detection hit never wipes an accumulated feed.
- `userSubredditsPath()` and the daily-sync flags live under
  `$DATA_DIR/gaming-journal/` (journal-owned), not the relay tree.
- Media downloads use plain `fetch` (Reddit CDNs need no fingerprinting); only the
  listing/comment JSON goes through the stealth browser.
