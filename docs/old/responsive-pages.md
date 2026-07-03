# Responsive Pages Plan

Make every page in the app look great on desktop (already done), tablet portrait/landscape, and phone portrait/landscape.

**Breakpoints (based on Samsung Galaxy S25 + Galaxy Tab S9):**
- Desktop / Tab landscape: ≥ 1280px (baseline — already done; Tab S9 landscape = 1280px CSS px)
- Phone landscape + Tab portrait: 480px–1279px (S25 landscape = 780px, Tab S9 portrait = 800px)
- Phone portrait: ≤ 479px (S25 portrait = 360px CSS px)

**Sidebar behavior per group:**
- ≥ 1280px: always visible
- 480px–1279px: hamburger, slides in at 300px
- ≤ 479px: hamburger, full-screen

**Status legend:** ✅ Done · 🔲 Not started · 🚧 In progress

See [pages.md](pages.md) for the full page inventory with per-breakpoint status tracking.

---

## Approach

1. Work through pages in order of complexity — simpler list pages first, complex detail pages after.
2. Each page: audit on all four non-desktop breakpoints, fix layout issues, mark status in pages.md.
3. Shared components (sidebar, nav rail, breadcrumb, cards) get fixed once and benefit all pages.

---

## ✅ Phase 1 — Shared chrome & simple lists (complete)

1. ✅ Sidebar / layout shell (`+layout.svelte`) — hamburger at < 1280px, full-screen drawer at ≤ 479px
2. ✅ Home (`/`) — single column at phone portrait, auto-height scrollable
3. ✅ History (`/history`) — 1-col featured row, 2-col rest grid at phone portrait
4. ✅ In Progress (`/in-progress`) — 1-col queue, 2-col rest grid, time/bar hidden on compact cards
5. ✅ Backlog (`/backlog`) — 1-col queue, 2-col rest grid, time hidden on compact cards, random button stacks
6. ✅ Favorites (`/favorites`) — hero full-width with min-height, 2-col cards below
7. ✅ Abandoned (`/abandoned`) — 2-col grid, invested badge hidden on compact cards
8. ✅ Completed (`/hall-of-fame`) — Legend tier 1-col, standard tiers 2-col, hours hidden on compact cards

**Patterns established for all remaining pages:**
- Side padding: 40px → 24px → 20px → 0 (inherits 16px from `#main-content`)
- Title: 2.4rem → 1.9rem → 1.6rem
- Separator: `gap: 14px`, `color: var(--clr-text-muted)` on container, no opacity on label
- Rest grids: `repeat(2, 1fr)` at phone portrait (minmax won't fit 2 cols at 328px)
- Badges/extras: hidden on compact 2-col cards to save space

## ✅ Phase 2 — Library & collections (complete)

9. ✅ Steam Library (`/library`) — 3-col at ≤ 1279px, 2-col at ≤ 479px; controls restructured into 3 rows (search+sort / pager / alpha); top pager hidden at phone portrait (bottom pager stays); back-to-top hidden at phone portrait; alpha bar horizontal-scroll single row with separator; sort direction folded into sort dropdown (separate ↑↓ button removed from both Library and Wishlist)
10. ✅ Wishlist (`/wishlist`) — shares all `lib-*` classes; same responsive behaviour as Library; sort dropdown expanded to 12 named options covering all 6 sort fields × 2 directions
11. ✅ Franchises (`/franchises`) — header padding steps down, stacks to column at ≤ 479px; grid single-col at ≤ 479px (auto-fill 2-col at tablet); mosaic cards get `min-height: 160px` at phone portrait for better image proportion; section spacing tightened at ≤ 799px and ≤ 479px
12. ✅ Franchise Detail (`/franchise/[id]`) — side padding steps down across all 3 breakpoints; hero shrinks to 220px at ≤ 479px; timeline restructured to paired image+bar elements (`frc-tl-pair`) so they wrap as units — 5-per-row at ≤ 799px, 4-per-row at ≤ 479px; arrow indicators hidden at ≤ 799px; separators added between Progress / Add Game / Entries / Delete sections; delete button redesigned in franchise amber (no red), fixed width via wrapper div to prevent parent padding override; section vertical spacing stepped down at mobile breakpoints

**Additional patterns established in Phase 2:**
- Responsive blocks must appear at the END of each CSS file — base styles first, media queries last (cascade order bug found and fixed in `franchises.css`)
- Sort direction should be folded into the sort dropdown, not a separate button
- Full-width flex children in a `flex-direction: column` parent need `align-self: flex-start` to size to content
- Elements that are direct children of a padded container need a wrapper div if they have their own internal padding

## ✅ Phase 3 — Discovery & tools (complete)

13. ✅ Discover (`/discover`) — padding steps down; grid 4→3→2 cols; tabs full-width equal-width at ≤479px with short labels; top pagination hidden at ≤479px
14. ✅ Recommend (`/recommend`) — topbar compacts at ≤479px; start card padding reduced; at ≤479px graph replaced with stacked box layout: question card + staggered option buttons + single-column game results, all animated with spring entrance
15. ✅ Sale Alerts (`/alerts`) — padding steps down across all 3 breakpoints; on-sale grid 2-col at ≤799px, 1-col at ≤479px (image+pricing cards too rich for 2-col at phone)
16. ✅ Calendar (`/calendar`) — nav wraps at ≤479px; year label hidden; day view replaced with vertical card list on phone with game art grids; auto-scrolls to today
17. ✅ Top Games (`/top-games`) — padding steps down; at ≤799px hides 24h Peak/7d Peak/All-Time/sparkline columns, grid narrows to 4 cols, mute button hidden; at ≤479px columns compress further; title swaps to "Top Games" short form

## ✅ Phase 4 — Game detail & journal (complete)

18. ✅ Game Detail (`/game/[appid]`) — breadcrumbs hidden; hero flush to top on mobile (JS `has-game-hero` class zeros `#main-content` padding-top at ≤1279px); hamburger clears hero content via 40px body padding-top at ≤479px; hero collapses to 1-col at ≤1279px with badges going static, spacer collapsed, data panel full-width; ProtonDB badge + loading strip relocated to left column below tag pills at ≤479px (right panel originals hidden); score chips (Steam/OpenCritic/Metacritic) stay in right panel at all widths; flags bar scrolls horizontally with hidden scrollbar at ≤479px; HLTB bar swapped for 3 stacked mini-bars at ≤479px; news sidebar replaced with `<select>` dropdown at ≤1279px; screenshots become horizontal swipe carousel with snap at ≤479px; ProtonDB section flex-wraps bar col at ≤1279px and compresses badge/stat text at ≤479px; PCGW controller card single-col at ≤1279px, first 5 rows visible with expand toggle at ≤479px; ITAD historic prices wrap to two lines at ≤479px via `display:contents` wrapper; section separators tightened from 44px → 28px (≤1279px) → 20px (≤479px); community reviews single-row horizontal scroll (was 2-row); local review bars redesigned to dashboard overlay style (2-col grid, label+value overlaid on fill); local review text collapses to 3-line clamp with expand toggle at ≤479px; all legacy breakpoints (640px, 768px, 960px, 600px) replaced with the two standard breakpoints

**Journal core** (`GameJournal.svelte` router → sub-pages; simplest first per established approach):

19. ✅ Journal – Pages (`/journal/[appid]/pages`) — `JournalPages.svelte`, 72 lines
20. ✅ Journal – Notes (`/journal/[appid]/notes`) — `JournalNotes.svelte`, 88 lines (StickyWall vendor lib already flex-wrap based with fixed note widths — no structural fix needed)
21. ✅ Journal – Progress (`/journal/[appid]/progress`) — `JournalProgress.svelte`, 90 lines
22. ✅ Journal – Achievements (`/journal/[appid]/achievements`) — `JournalAchievements.svelte`, 120 lines (`.gj-ach-grid` auto-fill minmax(260px,1fr) was already responsive; no fix needed there)

Fixed once, shared by all four sub-pages above: `.gj-sub-wrap` padding now steps 40 → 24 (≤1279px) → 20 (≤799px) → 0 (≤479px, matches the established pattern); `.gj-sub-actions` gained `flex-wrap: wrap` + full-width takeover at ≤479px (Progress page's 4 tracker-type buttons were clipping off-viewport, now wrap 2-per-row); breadcrumb component (`breadcrumb.css`, shared across the whole app) had its elastic-shrink truncation crushing crumbs to 1-2 characters ("H…", "JO…") at ≤479px — swapped to a horizontal-scroll strip (matches the flags-bar/alpha-bar pattern) so full labels stay legible and the user swipes instead.

23. ✅ Journal Dashboard (`/journal/[appid]`) — `JournalDashboard.svelte`, 680 lines; backed by `game-journal.css` (2468 lines, had zero media queries — largest single CSS file in the responsive effort so far). `.gj-grid` was a fixed 3-column grid with explicit placement (guides panel pinned to col 3/row 2-4 via inline style, HLTB card spanning cols 1-2) and no mobile treatment — columns just got proportionally thinner until text overlapped and cards clipped off the right edge. Collapsed to single column at ≤1279px (cards stack in DOM order); guides panel's inline `grid-column`/`grid-row` needed `!important` to override since inline styles otherwise beat a stylesheet media query. Found and fixed a real bug along the way: the HLTB segmented bar's `≤479px` mini-bar swap (`.hltb-bar-wrap → .hltb-mini`, defined globally in `game.css` for `HltbSection.svelte` on the Game Detail page) was silently blanking out on the Dashboard because `JournalDashboard.svelte` reimplements the HLTB bar inline and never rendered the `.hltb-mini` markup — added the matching mini-bar block so the swap has something to show. `.gj-dash` padding now steps 40 → 24 → 20 → 0 like the sub-pages. Card-internal layouts (guide tiles, heat cells, page-card previews) needed no changes — already flex-wrap/ellipsis/min-width:0 based, just needed the wider single-column card to breathe in.

**Guides sub-feature** (`/journal/[appid]/guides/...`; not originally tracked in this plan but part of the journal surface — added 2026-07-02. `guide-viewer.css` and `guide-inline-search.css` currently have zero media queries):

24. ✅ Guides List (`GuidesList.svelte`, 100 lines) — `/journal/[appid]/guides`. Already inherited `.gj-sub-wrap`/breadcrumb fixes from item 19-23's shared chrome; `.gl-grid` was already auto-fill responsive. One real fix: `.gl-card-meta` (pages/size/date row) had no `flex-wrap`, so at ~230px card width individual words split mid-phrase ("42" / "pages" on separate lines) — added `flex-wrap: wrap` + `white-space: nowrap` on the child spans so items wrap as whole units instead.
25. ✅ Guides Modal (`GuidesModal.svelte`, 334 lines) — download/search modal launched from Journal Dashboard. Built mobile-aware from the start (`.gm-panel` sizes off `min(640px, 100vw - 40px)`, source-tab bar already horizontal-scrolls). One gap: `.gm-row-action`'s 200px min-width crushed guide titles to ~6 characters ("Half-Lif…") at phone-portrait panel width — stacked `.gm-row` into info-then-actions at ≤479px instead of side-by-side.
26. ✅ Guide Search (`GuideInlineSearch.svelte` 203 lines, `GuidePageSearch.svelte` 159 lines) — needed no changes. `GuideInlineSearch`'s `.gis-box` already used the same `min(640px, 100vw - 32px)` viewport-relative pattern as `GuidesModal`; `GuidePageSearch`'s `.gps-wrap` is a simple flex bar that just needed its hardcoded `44px` side margin to track `.gv-content-inner`'s new stepped padding (done as part of item 27).
27. ✅ Guide Viewer (`/journal/[appid]/guides/[source]/[guideId]/[[section]]`) — `GuideViewer.svelte`, 970 lines, most complex of the set. `.gv-body`/`.gv-header-row` were a fixed 2-column grid (content + permanent 300px TOC sidebar) with zero mobile treatment — below 1280px the sidebar ate a third of the viewport and content overflowed off-screen entirely. Turned the sidebar into a right-side overlay drawer below 1280px by **reusing the existing `tocCollapsed` state** the desktop "collapse to a 40px icon rail" button already toggles — collapsed now means "drawer closed" instead of "40px rail" at that breakpoint, no new state needed. Added: a scrim (`.gv-toc-scrim`, only rendered/visible ≤1279px) that closes the drawer on tap; `GuideViewer.svelte` now defaults `tocCollapsed = true` on mobile load (ignoring the desktop-persisted localStorage preference) and re-collapses after `navTo()` so the drawer doesn't obscure the newly-loaded page; the gutter toggle button becomes a fixed round FAB (bottom-right) instead of a grid-edge tab. `.gv-content-inner`/`.gps-wrap` padding steps down from a flat 44px. GuideLanding.svelte (title/pills/search/mosaic) needed no changes — already used clamp()/flex-wrap/min()-based sizing throughout and rendered correctly once it had a properly-sized column to sit in. Caught and fixed one CSS-ordering bug of my own along the way: the scrim's base `display:none` rule was placed *after* its `@media` override in source order, so it always won regardless of viewport (equal specificity → last rule wins) — moved the base rule before the media block. Also found (via user report) and fixed a layering conflict between this drawer and the main app hamburger nav: both are full-screen mobile overlays, and if a user opened both at once the main nav always visually won regardless of the TOC drawer's higher z-index, because a pre-existing ancestor `<div style="position:relative;z-index:0">` in the route wrapper traps the drawer inside its own stacking context — no z-index number on the drawer can escape that. Rather than fight the stacking context, moved the main sidebar's open state into the shared `sidebar.svelte.ts` store (`appSidebarOpen`, was local to `+layout.svelte`) so `GuideViewer.svelte` can react and auto-collapse its own drawer when the main nav opens — only one full-screen overlay is ever open at a time now.

## ✅ Phase 5 — Community & account (complete)

Simplest first:

28. ✅ My Reviews (`/my-reviews`) — already close to responsive out of the box (`.mr-grid` auto-fill minmax(220px,1fr), sort dropdown fits fine next to search). Just needed the standard `.mr-header`/`.mr-controls`/`.mr-grid` padding step-down (40→24→20→0).
29. ✅ Account (`/account`) — padding stepped down across `.acct-hero`/`.acct-stats-strip`/`.acct-section` (the existing single `@media(max-width:800px)` 3-col stat rule was left as-is, just given the padding fix too). Found a real bug: `.acct-mp-row` ("Most Played" ranked list) is a 5-column grid (rank/thumbnail/name/bar/hours) with several fixed-width columns — at ≤479px the `1fr` name column was squeezed to ~0px, so **game titles were rendering completely invisible**, not just truncated. Restructured to a 2-row grid at ≤479px (rank+thumb+name on top, bar+hours spanning below) so the name gets real room.
30. ✅ Settings (`/settings`) — simple toggle-row list, already fluid (`flex:1;min-width:0` text + fixed 40px switch, tags/blocklist already `flex-wrap`). Just needed the standard padding step-down.
31. ✅ Community (`/community/[appid]`) — already fairly defensive going in (`.community-panel` auto-fill grid, `.community-post-meta`/`.community-tabs` already `flex-wrap`, manage-subreddits modal already `width:100%;max-width:480px`). Standard padding step-down; added `overflow-wrap: break-word` to the (previously unguarded) fixed 2.4rem title for long game names; header gained `flex-wrap` so the Pin badge doesn't fight the title for room at ≤479px.
32. ✅ Community Thread (`/community/[appid]/thread/[postId]`) — shares `community.css` with the page above. Standard padding step-down. Real fix: `.community-thread-post-card`'s image/gallery area was pinned to a `1fr 1fr` grid (image using only the left half) even once the layout drops to one column on mobile — wasted half the available width on every post image. Switched the card to a single-column grid at ≤799px so images/galleries use the full width.

## Phase 6 — Utility

29. Table of Contents (`/toc`)
30. Custom Page (`/[pageId]`)
