# Feature Docs — Index

All docs are checked off (written). See [guidance.md](guidance.md) for the format spec.

## Guides
- [x] [guides/downloading.md](guides/downloading.md) — job queue, fetch-guide.js, parse-guide.js, storage layout
- [x] [guides/refreshing.md](guides/refreshing.md) — re-fetch without force, refresh button in GuidesModal
- [x] [guides/landing.md](guides/landing.md) — GuideLanding, shimmer title, pills, full-text search (Fuse.js), cover mosaic
- [x] [guides/viewer.md](guides/viewer.md) — GuideViewer, nav tree, section loading, link interception, pins
- [x] [guides/search.md](guides/search.md) — guide discovery per source, GuidesModal search flow, _search.json
- [x] [guides/sources.md](guides/sources.md) — adapter contract, all 7 sources, ContentBlock + NavTree schemas
- [x] [guides/sources/ign.md](guides/sources/ign.md) — Next.js SSR wiki, BFS sidebar+body, slug probe + DDG search
- [x] [guides/sources/gamefaqs.md](guides/sources/gamefaqs.md) — HTML guides only, TOC-seeded BFS, browser image capture
- [x] [guides/sources/steam.md](guides/sources/steam.md) — single-page fetch sliced by section ID, Published File API search
- [x] [guides/sources/game8.md](guides/sources/game8.md) — BFS from game index, data-src lazy images, numeric archive IDs
- [x] [guides/sources/gamerguides.md](guides/sources/gamerguides.md) — server-rendered TOC, image-block→figure rewrite, HEAD-probe search
- [x] [guides/sources/fandom.md](guides/sources/fandom.md) — MediaWiki, Puppeteer BFS up to 700 pages, CDN image transform
- [x] [guides/sources/neoseeker.md](guides/sources/neoseeker.md) — Cloudflare-protected, 429 retry, wiki-toc accordion nav

## Journal
- [x] [journal/overview.md](journal/overview.md) — JournalDashboard, GameJournal, 7-parallel-fetch pattern
- [x] [journal/sessions.md](journal/sessions.md) — session tracking, now playing, relay poller, SessionHistoryRail
- [x] [journal/notes.md](journal/notes.md) — StickyWall, PageEditor, storage
- [x] [journal/progress.md](journal/progress.md) — 4 tracker types, HLTB integration, globalSegments()
- [x] [journal/trackers.md](journal/trackers.md) — individual tracker editing pages, data schemas, drag systems, color logic
- [x] [journal/auto-trackers.md](journal/auto-trackers.md) — AI tracker suggestion, suggest-job-queue, Downloads page auto-create

## Game
- [x] [game/game-page.md](game/game-page.md) — GamePage two-phase loading, GameHero, NavRail, all sections
- [x] [game/reviews.md](game/reviews.md) — LocalReviewCard, MyReview, CommunityReviews, Legendary star rule
- [x] [game/pricing.md](game/pricing.md) — ItadPrices, GdpPrices, undefined/null/object state pattern

## Collections
- [x] [collections/library.md](collections/library.md) — LibraryPage, sort/filter, pagination, state persistence
- [x] [collections/wishlist.md](collections/wishlist.md) — WishlistPage, local wishlist, ITAD prices, sort options
- [x] [collections/backlog.md](collections/backlog.md) — Backlog, queue, HLTB estimates, drag order
- [x] [collections/in-progress.md](collections/in-progress.md) — InProgress, HLTB progress bar, drag order
- [x] [collections/favorites.md](collections/favorites.md) — Favorites, hero slideshow
- [x] [collections/abandoned.md](collections/abandoned.md) — Abandoned, `dropped` flag naming note
- [x] [collections/completed.md](collections/completed.md) — Hall of Fame, 4 tiers by playtime
- [x] [collections/top-games.md](collections/top-games.md) — TopGames, player count table, sparklines, hide/filter
- [x] [collections/franchises.md](collections/franchises.md) — Franchises list + Franchise detail, derived status, mosaic
- [x] [collections/list-page.md](collections/list-page.md) — ListPage, custom journal checklists, two DnD systems

## Discovery
- [x] [discovery/recommend.md](discovery/recommend.md) — RecommendGraph, 8 filter types, depth toggle, graph layout
- [x] [discovery/discover.md](discovery/discover.md) — Discover page, featured tabs, search, title blocklist
- [x] [discovery/calendar.md](discovery/calendar.md) — Calendar, play history mode, releases mode, live session overlay

## Community
- [x] [community/community.md](community/community.md) — Reddit integration, subreddits, user prefs, pin strip

## Account
- [x] [account/account.md](account/account.md) — Account page, stats strip, recently played, session history
- [x] [account/my-reviews.md](account/my-reviews.md) — My Reviews grid, search/sort, Legendary star display
- [x] [account/settings.md](account/settings.md) — Settings, content filters, title blocklist, hideUnavailable quirk

## Global (app shell)
- [x] [global/sidebar.md](global/sidebar.md) — SidebarStore, polling, Now Playing card, badges, active item detection
- [x] [global/home.md](global/home.md) — Home page, conditional cards row, HomeMosaic flip animation
- [x] [global/global-search.md](global/global-search.md) — GlobalSearch overlay, Ctrl+Space, keyboard nav
