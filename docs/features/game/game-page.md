# Game Page

The per-game detail page at `/game/{appid}`. Shows everything about a single game: hero header, flags, trailers, about, HLTB, player counts, screenshots, news, reviews, pricing, ProtonDB, and PCGamingWiki. Sections load in two phases to keep the initial paint fast.

## Two-phase loading

### Phase 1 (parallel, blocks render)
8 fetches fire simultaneously on `onMount`. A loading bar shows each label as it resolves:

| Label | Endpoint | Data |
|-------|----------|------|
| Game | `GET /relay/api/games/{appid}` | Core game data, store info, hltb cache, itad cache |
| Community | `GET /relay/api/steam/community-reviews/{appid}` | Aggregated Steam review score |
| Reviews | `GET /relay/api/steam/reviews/{appid}` | User's own Steam review |
| Players | `GET /relay/api/player-counts/{appid}` | Historical player count data |
| Flags | `GET /api/flags/{appid}` | User's flags (playing, completed, etc.) |
| Journal | `GET /api/local-reviews/{appid}` | User's local review |
| Trailers | `GET /relay/api/videos/{appid}` | YouTube trailer list |
| Wishlist | `GET /api/local-wishlist/{appid}` | Local wishlist status |

### Phase 2 (background, non-blocking)
After Phase 1 renders, background tasks fire concurrently via a Web Worker (`game-refresh.worker.js`). Each resolves independently; sections appear as data arrives. `undefined` = still loading (shows spinner), `null` = fetched but no data (section hidden).

| Section | Endpoint | Condition |
|---------|----------|-----------|
| HLTB | `GET /relay/api/hltb/{appid}?fetch=true` | Only if `game.hltb` not already matched |
| ITAD | `GET /relay/api/itad/{appid}` | Always |
| PCGW | `GET /relay/api/pcgw/{appid}` | Only if not coming-soon |
| ProtonDB | `GET /relay/api/protondb/{appid}` | Always |
| News | `GET /relay/api/news/{appid}` | Always |
| Community sync | `POST /relay/api/steam/community-reviews/{appid}/sync` | Only if Phase 1 returned no community reviews |
| About refresh | `GET /relay/api/games/{appid}?refresh=true` | Only if `store.detailedDescription` missing |

## Back-navigation cache

Opening a sub-page (news article, mods, PCGamingWiki) and pressing Back restores the page instantly — same scroll position, no refetch, no loader flash. GamePage keeps a module-level snapshot per `appid` (in `<script module>`), TTL **5 minutes**:

1. On mount, if a fresh snapshot exists, all Phase 1 + Phase 2 state is seeded **synchronously** (page renders at full height, `loading=false`, no fetch), then the scroll offset is restored on the OverlayScrollbars viewport of `#main-content`. A `#game-sec-*` URL hash takes precedence — the fragment-jump effect owns the scroll then.
2. On destroy, a snapshot is written **only once fully settled** (`!loading && phase2Active && bgPending === 0`), so a half-loaded page is never cached with its pending fetches skipped.
3. Cache is capped at 12 entries; entries past the TTL are pruned on write.

Native gets the same effect structurally: the game routes are an expo-router `Stack` (the detail screen stays mounted under the sub-page) plus react-query `staleTime 60s`.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/game/GamePage.svelte` | Orchestrator: data loading, phase management, section assembly |
| `src/lib/svelte/game/GameHero.svelte` | Hero header with screenshot slideshow, score chips, breadcrumb |
| `src/lib/svelte/game/NavRail.svelte` | Floating right-side section jump nav |
| `src/lib/svelte/game/FlagsBar.svelte` | Compact flags row (playing, completed, wishlist, etc.) |
| `src/lib/svelte/game/HltbSection.svelte` | HLTB milestones display |
| `src/lib/svelte/game/PlayerChart.svelte` | Historical player count chart |
| `src/lib/svelte/game/sections/About.svelte` | Store description |
| `src/lib/svelte/game/sections/Trailers.svelte` | YouTube trailer embeds |
| `src/lib/svelte/game/sections/Screenshots.svelte` | Screenshot grid + lightbox |
| `src/lib/svelte/game/sections/News.svelte` | Steam news feed |
| `src/lib/svelte/game/sections/LocalReviewCard.svelte` | User's local review display |
| `src/lib/svelte/game/sections/MyReview.svelte` | User's Steam review |
| `src/lib/svelte/game/sections/CommunityReviews.svelte` | Aggregated Steam community review stats |
| `src/lib/svelte/game/sections/ItadPrices.svelte` | IsThereAnyDeal price history |
| `src/lib/svelte/game/sections/ProtonDB.svelte` | Linux compatibility tier + reports |
| `src/lib/svelte/game/sections/PCGW.svelte` | PCGamingWiki data (fixes, settings, API) |
| `src/workers/game-refresh.worker.js` | Web Worker for Phase 2 background fetches |

## NavRail

Floating icon-only nav on the right edge of the page. Portals itself to `document.body` in `onMount` so it escapes the game container's stacking context. Watches the container with a `MutationObserver` — when Phase 2 sections appear in the DOM, the rail rebuilds its visible item list. Active item tracks scroll position (section top ≤ 40% of viewport height).

Section IDs that the rail watches: `game-sec-hero`, `game-sec-trailers`, `game-sec-about`, `game-sec-hltb`, `game-sec-player-count`, `game-sec-screenshots`, `game-sec-news`, `game-sec-local-review`, `game-sec-steam-review`, `game-sec-community-reviews`, `game-sec-prices`, `game-sec-protondb`, `game-sec-pcgw`.

## GameHero

Full-bleed hero with a crossfading screenshot slideshow (two `<div>` elements with `background-image`, alternating opacity). 20% chance of a slow pan effect (`background-position` transition) on each frame. Displays: game name, playtime, community score, HLTB main time, Proton tier, current price (from ITAD). A loading badge fades out 1.2s after all Phase 2 sections finish.

## Screenshot lightbox

Created lazily on first click (`_openModal`), appended to `document.body`. Supports left/right arrow keys and prev/next buttons. `popstate` event closes it (back button).

## Common questions

**Q: A Phase 2 section shows a spinner but never loads.**
Phase 2 fires concurrently — one hanging request doesn't block others. Check the relay logs for the specific endpoint. Each Phase 2 task has its own try/catch; failure sets the state to `null` (hides section) rather than leaving it as `undefined` (spinner).

**Q: The About section is missing for some games.**
Phase 2 fetches `GET /relay/api/games/{appid}?refresh=true` only when `game.store.detailedDescription` is null. For discovered/wishlist games that were never synced from Steam, this triggers a store refresh. If still missing, the game may be unavailable on Steam.

**Q: Why use a Web Worker for Phase 2?**
Keeps the main thread free while background fetches resolve. The worker handles `GET` and `POST+GET` (sync-then-read) patterns. Falls back to main-thread fetch if `Worker` is unavailable.

**Q: HLTB shows stale data. How do I force a refresh?**
`refreshHltb()` in GamePage calls `POST /relay/api/hltb/sync/{appid}?force=true` then re-reads the game. There's a refresh button in `HltbSection` that triggers this.

**Q: A game shows "This game is no longer available on the Steam store" but it IS available.**
Stale `store.unavailable` sentinel from a past Steam throttle/403. Visiting the page now auto-re-checks it (TTL-gated to once per 24h; immediate on `?refresh=true`) and clears the banner if Steam has data. See the self-heal gotcha.

## Gotchas

- **`has-game-hero` class** is added to `#main-content` in `onMount` and removed in `onDestroy` — this adjusts layout (removes top padding) so the hero bleeds to the top edge. Forgetting to remove it on destroy causes the next page to also have no top padding.
- **Phase 2 state uses `undefined` vs `null`**: `undefined` = not yet fetched (show spinner); `null` = fetched, no data (hide section); object = data (show section). Don't conflate them.
- **`effectiveHltb` / `effectiveItad`** prefer the Phase 2 background result but fall back to the Phase 1 cache if Phase 2 isn't loading those sections. This prevents a "spinner flash" when the game already has cached data.
- **Community sync only fires if Phase 1 returned no community reviews** — this avoids a redundant POST on every page load when data is already cached.
- **HLTB empty state**: with zero playtime the gold progress fill stays at 0 (an empty track — no misleading animate-in). Each of the 3 milestone cells (MAIN / EXTRAS / COMPLETE) is instead tinted a distinct de-emphasised colour (teal → gold → plum). Same `SECTION_TINTS` on web (`HltbSection.svelte`) and native (`HltbSection.tsx`).
- **Store description entities**: the hero blurb (`store.description` = Steam `short_description`) is decoded (`&quot;` → `"`) server-side in `games.service` `mergeStore` via `shared/decode-entities.js`, so web and native both render clean text. `detailedDescription` stays raw HTML (rendered via `{@html}` / render-html) and must NOT be decoded.
- **`store.unavailable` self-heal + data preservation**: the sentinel is written only when Steam returns no data AND nothing good is cached. `recheckAppDetail` (and every relay sync path) preserves good cached data on a failed/empty fetch rather than blanking it — a failed *update* never destroys good data. The games route re-checks a stale `unavailable` game on view (24h TTL, or `?refresh=true`), synchronously so the banner clears on the same load.
