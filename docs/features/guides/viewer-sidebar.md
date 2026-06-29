# Guide Viewer — Right Sidebar

The right sidebar in the guide viewer provides two things: a collapsible TOC nav tree for jumping between guide pages, and a pin manager showing the user's saved positions. It lives at the right edge of the guide layout and can be collapsed to a 40px strip to reclaim screen space.

## Layout

The guide viewer uses a 2-column CSS grid in `.gv-body`:

```
[gv-content 1fr] [gv-toc-wrap 300px]
```

Collapsed state changes the grid to `1fr 40px` via `.gv-toc--collapsed` on `.gv-wrap`. The transition is animated via `transition: grid-template-columns 220ms`.

The collapse toggle button (`.gv-toc-gutter-btn`) is `position: fixed; right: 299px; top: 50%` — NOT inside the sidebar. `position: fixed` is required because the sidebar scrolls; any `position: absolute` ancestor would make `top: 50%` resolve to 50% of the scroll height, not the viewport. `right: 299px` overlaps the sidebar's `border-left` by 1px so the button merges flush with the panel edge. Collapsed override: `right: 39px`.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/guide/GuideViewer.svelte` | All sidebar state, collapse logic, TOC rendering, pin section, tooltip |
| `public/css/guide-viewer.css` | All sidebar CSS: grid, sidebar, TOC, collapse, gutter button |

## Expanded sidebar

`.gv-sidebar-inner` renders two sections, in order:

**1. Pins section** (only if `pins.length > 0`)
- Collapsible accordion: `pinsOpen` (`$state`, default `true`).
- Header row shows title, count badge, chevron toggle.
- Each pin entry: a nav button (page label + text snippet, calls `navToPin`) and a delete button (calls `deletePin(pin.id)`).
- If the guide was re-downloaded and pin paths may be stale, `staleNotice` (`$state`) shows a dismissible yellow banner at the top instead.
- A `gv-pins-rule` divider separates pins from the TOC.

**2. TOC nav tree**
- Source: `filteredNavTree` (`$derived`). Built from `meta.navTree` with entries filtered to only slugs that exist in `meta.pages`. Falls back to a flat `meta.pages` / `meta.nav` list if `navTree` is absent.
- Three item types from the nav tree:
  - `label` → non-interactive `<span class="gv-toc-label">` (section header text)
  - `link` → `<button class="gv-toc-link">`, active when `isActive(slug)`
  - `group` → collapsible container with `.gv-toc-group-hd` header and `.gv-toc-group-body` children. Groups track open state in `openGroups` (`$state<Set<string>>`). `autoOpenGroupFor(slug)` opens the group containing the active slug on page navigate.
- Active state: `.gv-toc-link--active` applied when `isActive(slug)` returns true (checks `currentSlug` prefix match).
- Author byline (`meta.author`) rendered below the TOC if present.

## Collapsed sidebar

When `tocCollapsed = true`, `.gv-sidebar` renders `.gv-toc-collapsed` instead of `.gv-sidebar-inner`:

- **Pin icons**: one `gv-tcc-pin` button per pin (gold pin SVG). Hover shows a fixed-position tooltip (`tocTooltip` state) with `"pageLabel — label"`. Click calls `navToPin`.
- **Divider rule** (`gv-tcc-rule`): shown only if there are pins.
- **Numbered page badges**: `collapsedPages` (`$derived`) — top-level links and groups only, no sub-pages. Each badge shows a number (`1`, `2`, …). Groups get `.gv-tcc-badge--group` (gold border). Active page gets `.gv-tcc-badge--active`. Clicking a navigable item calls `navTo`; clicking a group with no slug expands the TOC (`tocCollapsed = false`) instead.

`collapsedPages` builds from `filteredNavTree` if available, otherwise from `meta.pages`. `label` items are skipped. Groups are counted but their children are not pushed — avoids 100+ badges on large guides.

## Tooltip

`tocTooltip` (`$state<{ text, x, y } | null>`) drives a `position: fixed` tooltip rendered **outside** `.gv-wrap`. `showTocTooltip` sets the position from `getBoundingClientRect` of the hovered button. `hideTocTooltip` clears it. Fixed position is required — any overflow-clipping ancestor would hide a CSS `::after` tooltip.

## Scroll progress bar

A 2px gold strip at the top of `.gv-body` (`gv-scroll-progress` / `gv-scroll-progress-fill`). Only rendered when `currentSlug` is set (not on the guide landing page). Width driven by `scrollProgress` (`$state(0)`, 0–100).

`scrollProgress` is updated by a `$effect` that listens to the OverlayScrollbars viewport's `scroll` event. OverlayScrollbars is initialized on `contentEl` with `visibility: 'hidden'` (scrollbar track hidden; the progress bar replaces it). The progress bar's `right` value (`300px` / `40px`) transitions in sync with the grid collapse.

## Collapse persistence

`tocCollapsed` is read from `localStorage('guide-toc-collapsed')` in `onMount` and written on every toggle. Survives page navigation within the guide and across sessions.

## Common questions

**Q: Why is the gutter button `position: fixed` instead of `position: absolute`?**
The button must be at 50% of the *viewport* height, not the sidebar's scroll height. `position: absolute` inside any scrollable ancestor resolves `top: 50%` against the full scrollable height, placing the button far off screen on long guides. `position: fixed` always resolves against the viewport.

**Q: Why does `right: 299px` instead of `300px`?**
The sidebar has `border-left: 1px`. At exactly `right: 300px` the button's right edge meets that border and they look like two separate elements. `right: 299px` overlaps the border by 1px so the button and panel read as one unit.

**Q: Why is `.gv-toc-wrap` needed?**
`gv-toc-wrap` is the grid column 2 element. It has `overflow: hidden` to constrain the sidebar's scroll height to the grid cell. Without it, `gv-sidebar` with `height: 100%` has no bounded parent height and doesn't scroll correctly.

**Q: Why does collapsedPages skip sub-pages?**
Some guides have 170+ pages. Showing every sub-page as a badge in a 40px collapsed column is unusable. Only top-level links and group headers are shown; clicking a group with no slug expands the TOC so the user can navigate the full tree.

**Q: When does the fallback flat nav render instead of filteredNavTree?**
When `meta.navTree` is null or absent (older parsed guides, or sources that don't produce a nav tree). Falls back to `meta.pages ?? meta.nav`.

## Gotchas

- `gv-toc-gutter-btn` is a **sibling of `gv-toc-wrap`** inside `.gv-body`, not a child of the sidebar. Moving it inside any scrollable container breaks the `top: 50%` centering.
- The sidebar's native scrollbar is hidden via `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`. The OverlayScrollbars instance is on the **content column** (`.gv-content`), not the sidebar.
- `openGroups` is a Svelte 5 `$state<Set<string>>`. Mutating the Set in place does not trigger reactivity — always replace with `new Set(...)`.
- `staleNotice` and the pins stale banner are only shown once per page load. Dismissing sets `staleNotice = false` but does not prevent the banner from reappearing if the page is reloaded with a still-stale parsedAt.
