# Guide Viewer

Displays a downloaded guide in a two-column layout: scrollable content area on the left, sticky TOC nav tree on the right. Users navigate between guide pages, pin locations for quick return, and click images to enlarge.

## URL structure

```
/journal/{appid}/guides/{source}/{guideId}            ← guide landing page (no section)
/journal/{appid}/guides/{source}/{guideId}/{slug}     ← section page
/journal/{appid}/guides/{source}/{guideId}/{slug}#{anchor}  ← section + scroll to heading
```

The SvelteKit route is `src/routes/journal/[appid]/guides/[source]/[guideId]/[[section]]/+page.svelte`. The `[[section]]` param is optional — absence renders the landing page.

## Data flow

1. `onMount` → parallel fetch of `GET /relay/api/guides/{appid}/{source}/{guideId}/meta` and `GET /relay/api/games/{appid}`
2. `_meta.json` populates `meta` (title, navTree, pages[], parsedAt, author, sizeBytes)
3. If a `section` URL param is present, `loadSection(slug)` fires immediately
4. `loadSection` → `GET /relay/api/guides/{appid}/{source}/{guideId}/{slug}` → sets `blocks` (ContentBlock[])
5. After blocks render, scroll to pending pin path or fragment anchor
6. `$effect` on `section` prop re-calls `loadSection` on URL changes (handles browser back/forward)

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/guide/GuideViewer.svelte` | Main viewer: state, data loading, nav, pins, link interception |
| `src/lib/svelte/journal/guide/GuideBlockRenderer.svelte` | Renders ContentBlock[] to DOM (paragraphs, headings, tables, images) |
| `src/lib/svelte/journal/guide/GuideLanding.svelte` | Landing page shown when no section is selected (shimmer title, start button) |
| `src/lib/svelte/journal/guide/GuidesList.svelte` | `/journal/{appid}/guides` list of all downloaded guides for a game |
| `src/routes/journal/[appid]/guides/[source]/[guideId]/[[section]]/+page.svelte` | SvelteKit route |

## Nav tree

`meta.navTree` is an array of three node types:
- `{ type: 'link', slug, label }` — navigable page
- `{ type: 'group', slug?, label, children: NavItem[] }` — collapsible section with child pages
- `{ type: 'label', label }` — non-navigable heading (GameFAQs only)

Before rendering, `filteredNavTree` removes any nav items whose slug isn't present in `meta.pages[]`. This prevents nav entries for pages that exist in the source sidebar but weren't successfully downloaded. Groups with no valid children are also removed.

Groups auto-open when the current slug is a direct match or a child match (`autoOpenGroupFor`).

Fallback: if `filteredNavTree` is empty, the viewer renders a flat list directly from `meta.pages[]`.

## Link interception

Guide content HTML contains two kinds of internal links after parsing:
- `href="some-slug"` — navigate to another guide page
- `href="some-slug#heading-id"` — navigate to another page and scroll to heading
- `href="#heading-id"` — scroll to heading on the current page
- `href="#"` — navigate back to the guide landing page

**Why `onclick` is on the container div, not on individual `<a>` tags:** SvelteKit intercepts `<a href>` clicks at the capture phase, before bubble-phase handlers fire. Any `onclick` placed on a child `<a>` inside a SvelteKit-rendered page never fires for links SvelteKit handles. The fix is `onContentClick` on `.gv-content` (the container div), which catches bubbled clicks, finds the nearest `<a>` with `closest('a[href]')`, and handles navigation before SvelteKit sees it.

See memory: [SvelteKit link interception is capture-phase](../../memory/feedback_sveltekit_link_interception.md)

## Pins

One pin per page, stored in `localStorage` under key `guide-pins:{appid}:{source}:{guideId}`.

Pin structure:
```ts
{ id, slug, pageLabel, blockPath: number[], label }
```

`blockPath` is a child-index path from `.gv-content-inner` to the pinned DOM element (e.g. `[2, 0]` = third child of root, then first child). This is DOM-position-based, not text-based, so it's stable across re-renders but breaks if the page structure changes (guide re-download).

Stale detection: when loading pins, if `meta.parsedAt` differs from the stored `parsedAt`, all pins are cleared and a notice is shown. Re-downloading a guide always invalidates pins.

Pin limit: one pin per page slug (creating a second pin on the same page replaces the first).

Right-click anywhere in the content area opens a context menu with "Pin this location" / "Move pin here". Clicking a pin in the sidebar scrolls to it (or navigates to its page first if needed, then scrolls via `pendingPinPath`).

## Image modal

Clicking any image in the content opens a full-screen modal (DOM-appended `<div class="gv-img-modal">`). Created lazily on first click, reused thereafter. Escape or click-anywhere closes it.

## Table drag-to-scroll

Tables wider than the content area get horizontal drag-to-scroll on `.gv-table-wrap` and `.gv-p > table` elements. Mouse delta from `mousedown` drives `scrollLeft`. Clicks that follow a drag are suppressed (captured and `preventDefault`d) to avoid triggering links inside dragged tables.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `ArrowDown` | Scroll content down 85% of viewport height |
| `ArrowUp` | Scroll content up |
| `Escape` | Close image modal, then context menu (in that priority order) |

## Common questions

**Q: Why does navigating to a guide section show empty content?**
The page's `content.json` doesn't exist on disk — the page was never fetched or parsed. Refresh the guide from the GuidesModal to fetch missing pages. See [refreshing.md](refreshing.md).

**Q: Why is a nav item missing from the TOC sidebar?**
`filteredNavTree` strips items whose slug isn't in `meta.pages[]`. If the page wasn't downloaded (common for IGN body-only links before the June 2026 fix), it's filtered out. Refreshing the guide adds missing pages and rebuilds `_meta.json`.

**Q: Why aren't in-content link clicks working?**
Almost certainly a SvelteKit link interception issue. `onclick` on child `<a>` elements never fires — the handler must be on the container div (`onContentClick` on `.gv-content`). Do not add `onclick` to `<a>` elements inside `GuideBlockRenderer`.

**Q: Pins disappeared after re-downloading the guide. Why?**
Intentional. When `meta.parsedAt` changes (re-download rewrites `_meta.json`), stored pins are cleared because their `blockPath` indices may no longer point to the same content.

**Q: Why does the guide landing show instead of the first section?**
No `section` URL param → `currentSlug` is null → `GuideLanding` is rendered. Clicking "Start" navigates to `meta.pages[0].slug`. This is correct behavior — the landing is the entry point.

## Gotchas

- **OverlayScrollbars wraps `.gv-content`** — `scrollViewport()` returns the OS viewport element, not `contentEl` directly. Always use `scrollViewport()` for scroll operations; direct `contentEl.scrollTo()` won't work when OS is active.
- **`loadSection` does two fetches if the first fails and an anchor is present** — it first tries the full `slug#anchor` string, then falls back to the base slug. This handles the case where the route encodes the anchor in the URL.
- **`filteredNavTree` is `$derived`** — it recomputes whenever `meta` changes. Don't cache it manually.
- **Context menu is fixed-position** — it's rendered outside the scrollable content area (at the root of the component) to avoid being clipped by `overflow: hidden` on scroll containers.
