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

## Phase 2 — Library & collections ← next

9. Steam Library (`/library`)
10. Wishlist (`/wishlist`)
11. Franchises (`/franchises`)
12. Franchise Detail (`/franchise/[id]`)

## Phase 3 — Discovery & tools

13. Discover (`/discover`)
14. Recommend (`/recommend`)
15. Sale Alerts (`/alerts`)
16. Calendar (`/calendar`)
17. Top Games (`/top-games`)

## Phase 4 — Game detail & journal

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
