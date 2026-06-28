# Guide Pins

Lets the user drop a position marker on any content element in a guide page. One pin per page; pins appear in the TOC sidebar and auto-scroll the page on load. Right-clicking pinned content moves the pin to the new location.

## Data flow

### Creating a pin
1. User right-clicks anywhere in `.gv-content` → `onContextMenu` fires
2. `getBlockPath(target)` walks up from the clicked element to the nearest block-level ancestor (direct child of `.gv-content-inner`, or direct child of a `.gv-section` div) and records its child-index path from `.gv-content-inner` (e.g. `[2, 1]`)
3. `extractLabel(target)` pulls a text snippet from the clicked element (image caption/alt, table row cells, or nearest `p/li/h2/h3/h4`)
4. Context menu renders with "Pin this location" or "Move pin here" (if a pin already exists on this page)
5. User confirms → `doCreatePin` replaces any existing pin for this slug or pushes a new one → `savePins` writes to `localStorage`
6. `applyPinHighlights` runs (via `$effect`) → `resolveBlockPath` walks the DOM → injects `<button class="gv-pin-marker">` as the first child of the pinned element

### Navigating to a pin
- **Same page:** `navToPin` → `scrollToBlockPath` → `getBoundingClientRect` diff → `vp.scrollBy`
- **Different page:** `navToPin` sets `pendingPinPath`, calls `navTo(pin.slug)` → SvelteKit URL change → `$effect` on `section` calls `loadSection` → after `await tick()`, `pendingPinPath` is consumed and `scrollToBlockPath` fires

### Auto-scroll on page load
- `loadSection` also calls `scrollToBlockPath` for the page pin, but this fires while `loading = true` hides the `gv-wrap` block — `contentEl` is null, so the scroll silently no-ops
- `onMount` retries after `finally { loading = false }`: waits for `tick()`, then calls `scrollToBlockPathWhenReady`
- `scrollToBlockPathWhenReady` waits for all `<img>` elements **preceding** the target to finish loading (images that haven't expanded yet skew `getBoundingClientRect`), then calls `scrollToBlockPath`. Per-image timeout: 2 seconds

### Deleting a pin
- **Content area:** click the `gv-pin-marker` button (Lucide Pin SVG, gold, positioned at `left: -22px` in the margin) → `deletePin(id)` → updates `pins`, calls `savePins`, triggers `applyPinHighlights` to remove `.gv-pinned` class and marker button
- **Sidebar:** `×` button on the pin entry row (appears on hover)

### Re-download invalidation
- When the user clicks the refresh button on an already-downloaded guide in `GuidesModal`, `downloadGuide` checks `localStorage` for pins. If any exist, `confirmDialog` warns the user; confirmed → pins are cleared from `localStorage` before the job is enqueued
- On guide load, `loadPins` compares `meta.parsedAt` against the stored `parsedAt`. Mismatch → pins cleared, `staleNotice = true` → sidebar shows dismissible notice

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/guide/GuideViewer.svelte` | All pin logic: state, localStorage, block path utils, context menu, highlights, auto-scroll |
| `src/lib/svelte/journal/guide/GuideBlockRenderer.svelte` | Wraps table blocks in `gv-table-outer` (see Gotchas) |
| `src/lib/svelte/journal/guide/GuidesModal.svelte` | Re-download pin warning via `confirmDialog` |
| `public/css/guide-viewer.css` | `.gv-pinned`, `.gv-pin-marker`, `.gv-pins-*`, `.gv-ctx-*` |

## Storage layout

`localStorage` key: `guide-pins:{appid}:{source}:{guideId}`

```ts
interface PinStore {
    parsedAt: string | null   // meta.parsedAt at time of last save; used for stale detection
    pins: Pin[]
}

interface Pin {
    id: string                // crypto.randomUUID()
    slug: string              // base page slug, no #anchor
    pageLabel: string         // display label shown in sidebar
    blockPath: number[]       // e.g. [2, 1] — child indices from .gv-content-inner to element
    label: string             // text snippet extracted from the pinned element (≤70 chars)
}
```

One pin maximum per `slug`. Creating a second pin on the same page replaces the first (same `id` is reused).

## Common questions

**Q: What does `blockPath` actually point to?**
The nearest block-level DOM ancestor of the clicked element — either a direct child of `.gv-content-inner` (paragraph, list, figure, section div, `gv-table-outer`) or a direct child of a `.gv-section` div. The path is child indices, not element IDs. `[2, 1]` means: `inner.children[2].children[1]`.

**Q: Why does the pin marker sometimes not appear in the margin for a table?**
Tables were originally wrapped in `.gv-table-wrap` which has `overflow-x: auto`. An absolutely-positioned `left: -22px` child is clipped by overflow. The fix: `GuideBlockRenderer` now wraps each table in `.gv-table-outer` (no overflow, `position: relative`), and `.gv-table-wrap` is nested inside. `getBlockPath` resolves to `gv-table-outer` rather than `gv-table-wrap`.

**Q: Why doesn't the auto-scroll work on page refresh?**
Two-part issue: (1) `loadSection` runs while `loading = true`, so `gv-wrap` isn't rendered yet and `contentEl` is null — the scroll call silently no-ops. (2) Even after `loading = false`, images above the target haven't loaded yet, so `getBoundingClientRect` positions are wrong. Fixed by the `onMount` post-load retry with `scrollToBlockPathWhenReady`.

**Q: What happens if the guide is re-downloaded without going through the modal?**
`staleNotice` detection catches it. On next load, if `meta.parsedAt` differs from the stored `parsedAt`, pins are cleared and a yellow notice appears at the top of the sidebar.

**Q: Why is there no pin on the guide landing page?**
Pins require `currentSlug` to be set (a specific page is open). The landing page has `currentSlug = null`, so `onContextMenu` returns early.

## Gotchas

- **`applyPinHighlights` is imperative** — it runs `querySelectorAll('.gv-pinned')`, removes the class and injected marker button, then re-adds them for pins on the current page. It's called via a `$effect` watching `blocks`, `pins`, and `currentSlug`. The marker button is `el.prepend(btn)` — it lives at DOM index 0 inside the pinned element, but `blockPath` resolves the CONTAINER, not its first child, so the prepended button doesn't shift any stored paths.
- **`scrollToBlockPath` uses `scrollBy`, not `scrollTo`** — it computes `getBoundingClientRect` delta from the current scroll position and scrolls by that amount. This is correct for mid-session navigation (where `scrollTop` may not be 0) but fails on cold load (images not yet expanded). Use `scrollToBlockPathWhenReady` for cold-load scenarios.
- **Right-clicking the pin marker itself is intentionally suppressed** — `onContextMenu` checks `e.target.closest('.gv-pin-marker')` and returns without showing the custom menu. Clicking the marker deletes; right-clicking does nothing.
- **Pin icon is a Lucide `Pin` SVG string (`PIN_SVG` const)** — used both in the Svelte template (context menu) and in the imperatively-injected marker button (`btn.innerHTML = PIN_SVG`). No lucide npm package is installed; the SVG path is inlined, consistent with the rest of the project.
