# Sidebar (Left Nav)

The persistent left navigation bar rendered in `+layout.svelte`. Contains the Now Playing / Last Session card, pinned community strip, all nav links with count badges, and the History backdrop. Driven entirely by a reactive `store` singleton populated by pollers in the layout.

## Key files

| File | Role |
|------|------|
| `src/lib/Sidebar.svelte` | Component — renders all nav items, Now Playing card, pin strip, badges |
| `src/lib/sidebar.svelte.ts` | `SidebarStore` class — all reactive state fields |
| `src/lib/js/sidebar.ts` | Helper functions: `refreshAlertsBadge()`, `refreshSidebarItem()`, `addPageToSidebar()` |
| `src/routes/+layout.svelte` | Polling orchestration, `fmtElapsed()`, mobile toggle, global keyboard shortcut |
| `src/lib/guide-jobs.svelte.ts` | `jobStore` — `activeCount` drives the Downloads badge |

## Store (`sidebar.svelte.ts`)

`SidebarStore` is a Svelte 5 class with `$state` fields, exported as a singleton `store`:

```ts
store.nowPlaying   // NowPlayingInfo | null — currently playing game
store.lastPlayed   // LastPlayedInfo | null — last session game (shown when not playing)
store.alertsCount  // number — count of on-sale wishlist games
store.historyAppid // number | null — drives the History button backdrop image
store.counts       // SidebarCounts — badge counts for each collection
store.pin          // PinState | null — pinned community feed game
store.pages        // Page[] — all journal pages (used by /toc)
```

`SidebarCounts` fields:

| Field | Badge appears on |
|-------|-----------------|
| `library` | Steam Library |
| `wishlist` | Wishlist |
| `favorites` | Favorites |
| `inProgress` | In Progress |
| `backlog` | Backlog |
| `dropped` | Abandoned |
| `completed` | Completed (Hall of Fame) |
| `franchises` | Franchises |

## Polling (all in `+layout.svelte` `onMount`)

| Function | Endpoint(s) | Interval | What it updates |
|----------|-------------|----------|-----------------|
| `fetchNowPlaying()` | `GET /relay/api/steam/now-playing` | Every 60s | `store.nowPlaying`, `store.lastPlayed`, `store.historyAppid` |
| `fetchPin()` | `GET /relay/api/pin` | Every 60s (same timer) | `store.pin` |
| `fetchAlertsBadge()` | `GET /api/alerts` | Every 15min | `store.alertsCount` |
| `fetchCollectionCounts()` | `GET /api/flags` + `GET /relay/api/account` + `GET /api/franchises` | Once on mount | `store.counts` |
| `fetchHistoryBackdrop()` | `GET /relay/api/steam/playtime/last-played` | Once on mount | `store.historyAppid`, `store.lastPlayed` |

`fetchNowPlaying` and `fetchPin` share a single `setInterval` — they always fire together. Timers are cleaned up in the layout's `onDestroy` return.

`jobStore.connect()` is also called on mount — opens an SSE stream at `/relay/api/guides/jobs/stream` to keep `jobStore.jobs` up to date. `jobStore.activeCount` (jobs with status `pending` or `running`) drives the Downloads badge. This is not a poller — it's a persistent EventSource.

## Now Playing card

Shown when `store.nowPlaying` is set:
- Full-bleed header.jpg background with scrim overlay
- "Now Playing" eyebrow label + game name + elapsed time
- Animated orbit particle (CSS animation `now-playing-orbit`)
- Links to `/game/{appid}`

`elapsed` is computed by `fmtElapsed(playing.sessionStartedAt)` in the layout at fetch time, formatted as `"Xh Ym"` or `"Xm"`. It's a snapshot — not live-updating between polls. The elapsed time updates every 60s when the poll fires again.

**Transition**: when `fetchNowPlaying` gets back `playing: null`, it copies the current `store.nowPlaying` into `store.lastPlayed` before clearing it. So the Last Session card always shows whichever game just stopped, not just whatever was last-played historically.

## Last Session card

Shown when `store.nowPlaying` is null and `store.lastPlayed` is set:
- Same background + scrim layout, no orbit animation
- "Last Session" eyebrow label + game name (no elapsed — session is over)
- Links to `/game/{appid}`

`store.lastPlayed` is set from two sources:
1. `fetchNowPlaying()` — when a session ends, copies `nowPlaying` → `lastPlayed`
2. `fetchHistoryBackdrop()` — on mount, if neither nowPlaying nor lastPlayed is set, fetches the most recently played game from the playtime history and populates lastPlayed

## Pinned community strip

Shown when `store.pin` is set. A single-line strip below the Now Playing card:
- Colored dot: pulsing live indicator if `pin.reason === 'playing' && pin.sessionEndedAt === null`, otherwise static
- Game name + "Live community" / "Pinned community" label
- Links to `/community/{pin.appid}`

Pin is managed from the Community page — see [community.md](../community/community.md).

## History button backdrop

The History nav button has a faint blurred game header image as its background. This is driven by `store.historyAppid`: whichever appid is set renders `/relay/images/steam/games/{appid}/header.jpg` as the button's `background-image`.

Priority order for `historyAppid`:
1. Set to the currently playing game's appid during an active session (`fetchNowPlaying`)
2. Set to the most-recently-played game from the playtime history (`fetchHistoryBackdrop`)

## Badge styles

Two visual styles of badge:

| Style | Class | Used for |
|-------|-------|---------|
| Collection badge | `sidebar-collection-badge` | Library, Wishlist, Favorites, In Progress, Backlog, Abandoned, Completed, Franchises |
| Alert badge | `sidebar-alerts-badge` | Sale Alerts (`store.alertsCount`), Downloads (`jobStore.activeCount`) |

Collection badges are quiet/gray; alert badges are more prominent (typically accent-colored). They only render when the count > 0.

## Active item detection

`getActiveId(pathname)` in `Sidebar.svelte` maps the current URL to the nav item that should be highlighted:

```
/               → 'home'
/game/*         → 'library'   (game pages highlight Library)
/franchise/*    → 'franchises'
/journal/*      → null         (no highlight)
/community/*    → null         (no highlight)
/downloads      → 'downloads'
anything else   → first URL segment (e.g. /backlog → 'backlog')
```

`/journal/*` and `/community/*` return `null` because those are sub-pages of a specific game — highlighting a generic nav item would be misleading.

## Mobile behavior

On mobile, the sidebar is hidden off-screen by default. A hamburger toggle button (`#sidebar-toggle`) appears. Clicking it sets `sidebarOpen = true`, which:
- Adds `sidebar--open` class to `<aside>` (slides sidebar into view)
- Shows `#sidebar-overlay` (dark scrim over content)

Clicking the overlay, or any navigation (`afterNavigate`), resets `sidebarOpen = false`.

## Keyboard navigation within sidebar

`arrowNav()` in `Sidebar.svelte` handles `↑`/`↓` within the `<nav>`. Pressing ArrowDown while focused on a `.sidebar-nav-btn` moves focus to the next button; ArrowUp moves focus back. Allows keyboard-only navigation of the entire sidebar without Tab-tabbing through every item.

## Updating store from outside the layout

Three helper functions in `src/lib/js/sidebar.ts`:

```ts
refreshAlertsBadge()              // re-fetches /api/alerts → updates store.alertsCount
refreshSidebarItem(updatedPage)   // patches one Page in store.pages by id
addPageToSidebar(page)            // appends a new Page to store.pages
```

These are called from other parts of the app (e.g., after creating/editing a journal page) so the sidebar stays in sync without a full page reload.

## Common questions

**Q: The Now Playing card shows the wrong game / an old game.**
The card reflects `store.nowPlaying` which is polled every 60s from `GET /relay/api/steam/now-playing`. If Steam hasn't reported the new session to the relay yet, the card will lag by up to 60s. It's not real-time.

**Q: The elapsed time on the Now Playing card isn't updating.**
Elapsed time is computed once per 60s poll and stored as a formatted string. It does not tick in real-time between polls. To get live elapsed time, see the journal sessions doc — the journal dashboard uses a separate live poller.

**Q: A collection badge count is wrong.**
`fetchCollectionCounts()` runs once on mount (not on a timer). If flags change during the session (e.g., you add a game to Backlog), the badge won't update until the next page load. If the count is consistently wrong, check the `GET /api/flags` response — it must include all games.

**Q: The Downloads badge shows a number but no jobs are visible on the Downloads page.**
`jobStore.activeCount` counts jobs with status `pending` or `running` from the SSE stream. If the stream dropped and reconnected, it receives a `snapshot` event with the current job list. If the Downloads page shows nothing, the SSE may have emitted a stale snapshot — refresh the page.

**Q: I added a new nav item to the sidebar. How do I make it highlight correctly?**
Add a case to `getActiveId()` in `Sidebar.svelte`. The default behavior is to match the first URL segment, so `/my-new-route` will match automatically if the nav item's `data-id` equals `my-new-route`. Only add a special case if the URL structure doesn't match the item ID.

## Gotchas

- **`store.pages` is not a nav item list** — it's the list of all journal `Page` records (notes, trackers, lists), used by the `/toc` (table of contents) page. It's unrelated to the sidebar nav links themselves.
- **`dropped` vs `abandoned`**: the flag is called `dropped` in `SidebarCounts` and in `flags`, but the nav item is labeled "Abandoned" and routes to `/abandoned`. If you're filtering by this flag in other code, use `f.dropped`, not `f.abandoned`.
- **`fmtElapsed` is in the layout, not the store** — it's a pure function that runs at poll time. The `elapsed` string is baked into `NowPlayingInfo` when stored. Don't look for elapsed-time logic in `sidebar.svelte.ts`.
- **Pin 204 response means "no pin"** — `fetchPin()` treats HTTP 204 as `store.pin = null`. Any other non-OK status leaves `store.pin` unchanged (preserves the last known state rather than clearing it on transient errors).
