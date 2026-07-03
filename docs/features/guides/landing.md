# Guide Landing Page

The first screen shown when opening a guide (`/journal/{appid}/guides/{source}/{guideId}` with no section selected). Rendered by `GuideLanding.svelte` when `currentSlug` is null in `GuideViewer`. Contains a shimmer title, metadata pills, a full-text search bar, and a 6-cell cover-image mosaic.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/guide/GuideLanding.svelte` | Landing page component |
| `src/lib/svelte/journal/guide/GuideViewer.svelte` | Mounts GuideLanding when `!currentSlug` |
| `relay-server/src/controllers/guides/guides.controller.js` | Serves `GET /relay/api/guides/{steamId}/{source}/{guideId}/fulltext` |
| `public/css/guide-viewer.css` | `.gl-*` styles including `.gl-title` shimmer animation |

## Layout

`GuideLanding` is rendered as a **direct child of `.gv-content`** (not wrapped by `.gv-content-inner`), so its `height: 100%` resolves to the full height of the content column. The landing never scrolls — it is a fixed-height flex column that clips overflow.

The template renders exactly three sections inside `<div class="gl-landing">`:

1. `<h2 class="gl-title">` — guide title with shimmer animation
2. `<div class="gl-pills">` — metadata pills row
3. `<div class="gl-search">` — search bar + results
4. `<div class="gl-mosaic">` — cover image mosaic (conditional on `slots.length >= 6`)

There is no "Start" button in the template. The `onStart` prop is defined but unused in the current UI.

## Title + pills

`<h2 class="gl-title">` renders the guide title with a gold shimmer CSS animation — warm cream base with a narrow gold band sweeping across on a loop.

Pills row below the title (`.gl-pills`):

| Pill | Condition | Content |
|------|-----------|---------|
| Source | Always | e.g. "GameFAQs", "IGN" (from `SOURCE_LABELS` map) |
| Page count | Always | e.g. "42 pages" |
| File size | `sizeBytes` truthy | `fmtBytes(sizeBytes)` — KB under 1 MB, one decimal MB above |
| Synced date | `parsedAt` truthy | `new Date(parsedAt).toLocaleDateString(...)` |
| View original | `sourceUrl` truthy | External link to source URL, opens in new tab |

## Full-text search

Search is lazy — the Fuse.js index is not fetched until the user focuses the input.

### Index loading

On `onfocus` of the search input, `loadIndex()` fires once (guarded by `fuseInst` null check):

```
GET /relay/api/guides/{steamId}/{source}/{guideId}/fulltext
→ FtEntry[]
```

```ts
interface FtEntry { slug: string; label: string; text: string }
```

One `FtEntry` per content block — a single guide page produces multiple entries (one per paragraph/table/heading). `slug` is the page slug, `label` is the page title, `text` is the plain-text content of that block.

The array is loaded into a Fuse.js instance with these options:

| Option | Value | Why |
|--------|-------|-----|
| `keys` | `['text']` | Search block content only |
| `threshold` | `0.3` | Tighter than default — filters weak matches |
| `minMatchCharLength` | `3` | Ignores single-char noise |
| `ignoreLocation` | `true` | Searches full text, not prefix-weighted |
| `includeMatches` | `true` | Needed for snippet index extraction |
| `includeScore` | `true` | Available but not currently displayed |

`searchReady = true` once loading completes. While `!searchReady && query` is truthy, a `…` loading indicator appears inline.

### Query execution

- `oninput` → 180ms debounce → `runSearch(query)`
- `fuseInst.search(q.trim(), { limit: 60 })` returns raw hits
- Results grouped by `slug` (best-score first within each page):
  - Max **6 distinct pages**
  - Max **3 snippets** per page

A `$effect` also re-runs `runSearch` whenever `searchReady` flips true while a query is already typed.

### Snippet rendering

Each snippet is built by `makeSnippet(text, indices)`:

- Context window: ±80 characters around the first match index pair
- Leading `…` if `from > 0` (match isn't at text start)
- Match term wrapped in `<mark>` (browser default highlight)
- Trailing `…` if `to < text.length`
- `esc()` HTML-escapes `&`, `<`, `>` before inserting into the `{@html ...}` block

Clicking a result group's page-label button calls `onNav(group.slug)` → `GuideViewer.navTo(slug)` → SvelteKit navigates to that section.

Empty state: `<p class="gl-search-empty">No results for "…"</p>` shown when `query.trim() && searchReady && hits.length === 0`.

## Mosaic

A 3×2 grid of guide cover images that flip every **5 seconds**. Only renders when `slots.length >= 6` (i.e. `coverImages.length >= 6`).

The mosaic uses `flex: 1; min-height: 0` so it fills whatever vertical space remains after the title, pills, and search bar. It has no fixed aspect ratio — height adapts to the viewport. When search results are visible they consume space above, the mosaic shrinks accordingly.

`coverImages` comes from `meta.coverImages[]` — images extracted from guide content during parse. Each entry: `{ section: string, src: string }` where `section` is the page slug the image came from and `src` is the relative filename (e.g. `img/001.jpg`).

Resolved image URL:
```
/relay/guides-img/{steamId}/{source}/{guideId}/{section}/img/{filename}.webp
```
The `.webp` extension replaces whatever the original extension was — images are converted during download.

### Flip mechanics

On mount: `allImages` is shuffled, first 6 assigned as initial slots with `flipClass: ''`.

Every 5s, `tick()` fires:
1. Shuffles `allImages`, picks 6
2. For any slot where `pool[i].src === slots[i].front.src`, swaps with slot `(i+1) % 6` to guarantee a visible change
3. Each slot is assigned a random axis (`X` or `Y`) and a random CSS delay (`0–450ms`)
4. `flipClass` set to `flip-x` or `flip-y` triggers the CSS animation
5. `onanimationend` → `onFlipEnd(i)` promotes `back → front`, clears `flipClass`

The grid column count is `Math.min(slots.length, 3)`, always 3 since `slots.length` is fixed at 6.

## Common questions

**Q: The search bar shows "…" indefinitely.**
`loadIndex()` threw or the relay returned an empty array. The `catch` block silently leaves `fuseInst = null` and `searchReady = false`. Check relay logs for `GET .../fulltext`. If the guide was just downloaded, ensure parse completed (`_meta.json` exists on disk).

**Q: A search result's slug navigates to an empty page.**
The slug is in the fulltext index but was filtered out of `meta.pages[]` in `filteredNavTree`. This can happen if the fulltext index is stale relative to a guide refresh. Re-download the guide to rebuild both.

**Q: The mosaic doesn't appear.**
The guide has fewer than 6 cover images. Common with text-heavy guides (GameFAQs ASCII walkthroughs) that contain few or no screenshots.

## Gotchas

- **`fuseInst` is not cached across mounts** — if the user navigates away and back to the landing page, the component remounts and the index is `null` again. It re-fetches on the next focus. Intentional — prevents stale results after a guide refresh.
- **One `FtEntry` per content block, not per page** — a page with 40 paragraphs produces 40 index entries. `runSearch` collapses them back to at most 3 snippets per page in the results.
- **`ignoreLocation: true` is load-bearing** — without it, Fuse down-weights matches deep in long text blocks, causing poor recall on guide content where the relevant term appears mid-paragraph.
- **Mosaic images always use `.webp`** — `imgUrl()` strips the original extension and appends `.webp`. The relay only stores the converted file; requesting the original extension would 404.
- **`onStart` prop is defined but unused** — it appears in the prop signature but has no corresponding button or call site in the current template. It may be a vestigial API from an earlier design.
