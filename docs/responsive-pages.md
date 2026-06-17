# Responsive Pages Plan

Make every page in the app look great on desktop (already done), tablet portrait/landscape, and phone portrait/landscape.

**Breakpoints:**
- Desktop: 1024px+ (baseline — already done)
- Tablet landscape: ~768px–1023px
- Tablet portrait: ~600px–767px
- Phone landscape: ~480px–599px
- Phone portrait: <480px

**Status legend:** ✅ Done · 🔲 Not started · 🚧 In progress

See [pages.md](pages.md) for the full page inventory with per-breakpoint status tracking.

---

## Approach

1. Work through pages in order of complexity — simpler list pages first, complex detail pages after.
2. Each page: audit on all four non-desktop breakpoints, fix layout issues, mark status in pages.md.
3. Shared components (sidebar, nav rail, breadcrumb, cards) get fixed once and benefit all pages.

---

## Phase 1 — Shared chrome & simple lists

1. Sidebar / layout shell (`+layout.svelte`)
2. Home (`/`)
3. History (`/history`)
4. In Progress (`/in-progress`)
5. Backlog (`/backlog`)
6. Favorites (`/favorites`)
7. Abandoned (`/abandoned`)
8. Completed (`/hall-of-fame`)

## Phase 2 — Library & collections

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
