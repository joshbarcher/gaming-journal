# Sidebar (Left Nav)

The persistent left navigation bar rendered in `+layout.svelte`. Contains the Now Playing / Last Session card, pinned community strip, all nav links with count badges, and the History backdrop. Driven by a reactive `store` singleton populated by pollers in the layout. Supports desktop collapse to icon-only mode, persisted across sessions.

## Key files

| File | Role |
|------|------|
| `src/lib/Sidebar.svelte` | Component — renders nav items, Now Playing card, pin strip, badges |
| `src/lib/sidebar.svelte.ts` | `SidebarStore` class — all reactive state fields |
| `src/lib/js/sidebar.ts` | Helper functions: `refreshAlertsBadge()`, `refreshSidebarItem()`, `addPageToSidebar()` |
| `src/routes/+layout.svelte` | Polling orchestration, collapse state, mobile toggle |
| `src/lib/guide-jobs.svelte.ts` | `jobStore` — `activeCount` drives the Downloads badge |
| `public/css/layout.css` | Layout shell, sidebar width/transition, gutter button styles |
| `public/css/sidebar.css` | All sidebar visual styles including collapsed overrides and CSS tooltips |

## Store (`sidebar.svelte.ts`)

`SidebarStore` is a Svelte 5 class with `$state` fields, exported as singleton `store`:

| Field | Type | Content |
|-------|------|---------|
| `nowPlaying` | `NowPlayingInfo \| null` | Currently playing game |
| `lastPlayed` | `LastPlayedInfo \| null` | Last session (shown when not playing) |
| `alertsCount` | `number` | On-sale wishlist games |
| `historyAppid` | `number \| null` | Drives History button backdrop image |
| `counts` | `SidebarCounts` | Badge counts per collection |
| `pin` | `PinState \| null` | Pinned community feed game |
| `pages` | `Page[]` | All journal pages (used by `/toc`) |

`SidebarCounts` keys: `library`, `wishlist`, `favorites`, `inProgress`, `backlog`, `dropped`, `completed`, `franchises`.

## Polling (`+layout.svelte` onMount)

| Function | Endpoint(s) | Interval | Updates |
|----------|-------------|----------|---------|
| `fetchNowPlaying()` | `GET /relay/api/steam/now-playing` | 60s | `nowPlaying`, `lastPlayed`, `historyAppid` |
| `fetchPin()` | `GET /relay/api/pin` | 60s (same timer) | `pin` |
| `fetchAlertsBadge()` | `GET /api/alerts` | 15min | `alertsCount` |
| `fetchCollectionCounts()` | `GET /api/flags` + account + franchises | Once | `counts` |
| `fetchHistoryBackdrop()` | `GET /relay/api/steam/playtime/last-played` | Once | `historyAppid`, `lastPlayed` |

`jobStore.connect()` opens a persistent SSE stream at `/relay/api/guides/jobs/stream`. `jobStore.activeCount` (pending/running jobs) drives the Downloads badge.

## Desktop collapse

`sidebarCollapsed` (`$state(false)`) lives in `+layout.svelte`. It's initialized from `localStorage('sidebar-collapsed')` in `onMount` and toggled by `toggleCollapse()`, which writes back to localStorage.

The `sidebar--collapsed` class is applied to `<aside#sidebar>`. All visual changes are CSS-driven:

- Sidebar narrows to 56px (width transition: 220ms cubic-bezier).
- `.sidebar-nav-label` spans (wrapping each button's text) → `display: none`.
- `.sidebar-collection-badge`, `.sidebar-alerts-badge` → `display: none`.
- Nav buttons → `justify-content: center`.
- Now Playing text body hidden; orbit particle scales down to fit the narrow card; gold glow animation persists.
- Pin strip → dot only, centered.

**Tooltips:** each `.sidebar-nav-btn` carries a dynamic `data-tooltip` attribute (label + count, e.g. `"Backlog (12)"`). In collapsed mode a CSS `::after` pseudo-element reads `attr(data-tooltip)` and fades in on hover. Offset is `left: calc(100% + 28px)` to clear the 14px gutter button.

**Gutter button:** `.sidebar-gutter-btn` is in `+layout.svelte` inside `<aside>`, positioned `left: 100%; top: 50%` — a 14×48px tab with rounded right corners that merges with the sidebar border. Hidden on mobile (`max-width: 1279px`).

**Overflow plumbing:** `#sidebar` is `position: relative; overflow: visible; z-index: 1` on desktop so the gutter button and tooltips escape its right edge. The mobile media query restores `overflow: hidden`. `#sidebar.sidebar--collapsed` bumps `z-index` to 10 and sets `#sidebar-nav` to `overflow: visible` for tooltip escape. The `collapsed` prop on `Sidebar.svelte` is used only for conditional `title` attributes on the Now Playing card and pin strip (browser native tooltip as fallback).

## Active item detection

`getActiveId(pathname)` in `Sidebar.svelte` maps the current URL to the highlighted nav item:

```
/               → 'home'
/game/*         → 'library'
/franchise/*    → 'franchises'
/recommend      → 'recommend'
/journal/*      → null
/community/*    → null
/downloads      → 'downloads'
anything else   → first URL segment
```

## Mobile behavior

Sidebar is hidden off-screen by default (`transform: translateX(-100%)`). Hamburger toggle (`#sidebar-toggle`) sets `sidebarOpen = true` → adds `sidebar--open` class → sidebar slides in. Overlay click or `afterNavigate` resets to closed. The collapse feature is desktop-only; `sidebarCollapsed` is ignored on mobile.

## Common questions

**Q: The Now Playing card shows the wrong game / an old game.**
`store.nowPlaying` polls every 60s. It lags by up to 60s after a session starts or ends.

**Q: A collection badge count is wrong.**
`fetchCollectionCounts()` runs once on mount. Counts won't update mid-session. Check the `GET /api/flags` response if consistently wrong.

**Q: I added a new nav item. How do I wire up active highlighting?**
Add a `data-id` matching the URL segment. The default catches `/my-new-route → 'my-new-route'`. Only add a `getActiveId` case if the URL structure doesn't match the item ID. Also add a `data-tooltip` attribute for the collapsed tooltip.

## Gotchas

- **`store.pages` is not the nav link list** — it's all journal `Page` records, used only by `/toc`.
- **`dropped` vs `abandoned`**: flag is `dropped` in store/API, but the nav label is "Abandoned" and route is `/abandoned`.
- **`fmtElapsed` is in the layout, not the store** — baked into `NowPlayingInfo.elapsed` at poll time; doesn't tick live between polls.
- **Pin 204 = no pin** — `fetchPin()` treats HTTP 204 as `store.pin = null`; other errors leave `pin` unchanged.
- **Tooltip clipping** — tooltips escape via `overflow: visible` on `#sidebar`. If a future change adds `overflow: hidden` back to `#sidebar` on desktop, collapsed tooltips will disappear silently.
- **History button needs `overflow: visible` when collapsed** — `.sidebar-history-btn` normally has `overflow: hidden` (for the backdrop clip). The collapsed CSS overrides it to `visible` so the tooltip `::after` isn't clipped.
