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

## Phase 4 — Game detail & journal ← next

18. Game Detail (`/game/[appid]`)
19. Journal Dashboard (`/journal/[appid]`)
20. Journal – Achievements (`/journal/[appid]/achievements`)
21. Journal – Notes (`/journal/[appid]/notes`)
22. Journal – Progress (`/journal/[appid]/progress`)
23. Journal – Pages (`/journal/[appid]/pages`)

## Phase 5 — Community & account

24. Community (`/community/[appid]`)
25. Community Thread (`/community/[appid]/thread/[postId]`)
26. My Reviews (`/my-reviews`)
27. Account (`/account`)
28. Settings (`/settings`)

## Phase 6 — Utility

29. Table of Contents (`/toc`)
30. Custom Page (`/[pageId]`)
