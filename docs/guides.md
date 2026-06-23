# Guides

## Overview

The guides system downloads, parses, and surfaces guides from three sources: **GameFAQs**, **IGN**, and **Steam Community**. Each guide is associated with a Steam App ID and a source name (`gamefaqs`, `ign`, or `steam`).

---

## Data Storage

Guides live on the NAS at:
```
\\192.168.86.74\app-data\relay\guides\{steamId}\{source}\
```

Each source folder contains:
- `_raw/` — raw HTML files written by the fetcher (one `.html` per section/page)
- `_raw/_manifest.json` — page list, sourceUrl, fetchedAt (+ title/author for Steam)
- `_meta.json` — guide metadata (title, author, navTree, pages list, parsedAt) — written by parser
- One folder per section slug, each containing `content.json` + `preview.html` + `img/`

Full layout:
```
$DATA_DIR/relay/guides/{steamId}/
  _search.json                       ← search results for all sources
  {source}/                          ← gamefaqs/, ign/, steam/
    {guideId}/
      _raw/
        _manifest.json
        _index.html                  ← IGN only: index page
        {slug}.html                  ← one file per section/page
      _meta.json
      {slug}/
        content.json                 ← ContentBlock[] (app-facing)
        preview.html                 ← standalone preview for testing
        img/                         ← downloaded + WebP-converted images
```

### Steam ID Mapping

The folder name must match the game's **current** Steam App ID. Notable cases:
- `3375780` — Trails in the Sky 1st Chapter (remake; NOT 251150 which is the 2014 classic)
- `2072450` — Like a Dragon: Infinite Wealth
- `3764200` — Resident Evil Requiem
- `920210` — LEGO Star Wars: The Skywalker Saga

---

## Two-Step Pipeline

Every guide goes through two scripts in `relay-server/src/tools/`:

1. **`fetch-guide.js`** — launches Puppeteer (or calls an API for Steam search), saves raw HTML to `_raw/`, writes `_manifest.json`
2. **`parse-guide.js`** — reads `_raw/` + manifest, writes `content.json` + `preview.html` + `img/`

To re-parse with fixes: just re-run `parse-guide.js --no-images` — images already on disk are reused, no network needed.

`--no-images` only skips downloading NEW images; it still resolves `localSrc` for images already on disk.

---

## Adapter Contract

All three source adapters (`gamefaqs/adapter.js`, `ign/adapter.js`, `steam/adapter.js`) must export:

```js
resolveContentSelector($)                         → string
buildAdapter(contentSelector)                     → { contentSelector, junkSelectors, unwrapSelectors?, transformImageUrl? }
extractTitle($)                                   → string | null
extractNavTree($, guideId, manifestPages?)        → NavItem[] | null
slugToLabel(slug)                                 → string
rewriteInternalLinks(html, guideId, knownSlugs?) → string

// Optional:
preprocessRawHtml?(html, guideId)                → string
extractNavLinksFromDoc?(...)                      → PageLink[]   // IGN only
isTextGuide?($)                                  → boolean      // GameFAQs only
extractAuthor?($)                                → string|null
```

`buildAdapter` can return `unwrapSelectors` — elements that get replaced with their children before junk removal. Used by the Steam adapter to strip `<a class="modalContentLink">` image popup wrappers before the `ALWAYS_REMOVE` pass runs on `<a>` tags.

---

## _search.json Schema

Written by the controller's search endpoints. All sources share the same top-level structure:

```json
{
  "steamId": "...",
  "sources": {
    "gamefaqs": {
      "searchedAt": "ISO string",
      "matchedGame": { "name": "...", "platform": "...", "gameUrl": "...", "score": 1.0 },
      "guides": [{ "title": "...", "url": "...", "type": "html|text|unknown" }]
    },
    "ign": {
      "searchedAt": "ISO string",
      "matchedGame": { "name": "...", "gameUrl": "...", "score": 1.0 },
      "guides": [{ "title": "...", "url": "...", "type": "html" }]
    },
    "steam": {
      "searchedAt": "ISO string",
      "matchedGame": { "name": "...", "gameUrl": "...", "score": 1.0 },
      "guides": [{ "title": "...", "url": "steamcommunity.com/sharedfiles/filedetails/?id=...", "type": "html" }]
    }
  }
}
```

`matchedGame.platform` is optional — GameFAQs populates it, IGN and Steam do not.

---

## Relay API

Endpoints served by the relay server (`relay-server/src/controllers/guides/guides.controller.js`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/guides/:steamId` | List all downloaded guides for a game |
| GET | `/api/guides/:steamId/search` | Return cached `_search.json` |
| POST | `/api/guides/:steamId/search` | Run a live search (SSE stream) |
| POST | `/api/guides/:steamId/download` | Download + parse a guide (SSE stream) |
| GET | `/api/guides/:steamId/:source/:guideId/meta` | Full `_meta.json` for a guide |
| GET | `/api/guides/:steamId/:source/:guideId/:section` | `content.json` for a section |

Static images are served at:
```
/guides-img/{steamId}/{source}/{guideId}/{section}/img/{filename}
```

Section slugs containing `#` (anchor slugs like `intro#mechanics`) must be `encodeURIComponent()`-encoded in both API calls and navigation URLs.

---

## Journal Dashboard — Guides Card

- Located in column 3, always spanning rows 2–3 (`grid-column: 3; grid-row: 2/4`)
- **Always rendered** — shows "No guides available" when none exist; never conditionally hidden
- Must appear **before** the HLTB card in the DOM so CSS grid auto-placement fills columns 1–2 correctly
- Displays guides in a **2×2 grid** (targeting 4 guide sources)
- Clicking a guide subcard navigates to `/journal/{appid}/guides/{source}`

---

## Guide Viewer Route

```
/journal/[appid]/guides/[source]/[[section]]
```

`[[section]]` is optional — omitting it loads the first page of the guide.

### Layout — Three Columns

```
[44px gutter] [1fr content] [280px sidebar]
```

**Row 1 (header):** Breadcrumbs + H1 title (content column) | "CONTENTS" label (sidebar column). Both share the same font (`--font-title`, `clamp(18px, 2.5vw, 26px)`), same top padding, same baseline.

**Row 2 (separator):** A full-width `1px` rule spanning all columns.

**Row 3 (body):** Guide content (center) | TOC nav links (right). The sidebar uses `position: sticky; top: 0` with `align-self: stretch` so it fills the column height and scrolls internally when the TOC is taller than the viewport.

The right sidebar panel background (`--clr-bg-raised`) and left border span from the very top of the page to the bottom — the `padding-top: 32px` lives on both `.gv-header-main` and `.gv-header-toc` rather than on the outer wrap, so nothing interrupts the panel.

### Left Gutter Arrows

- `position: fixed` at `left: calc(var(--sidebar-w) + 6px)`, vertically centered (`top: 40%`)
- Click or keyboard `↑`/`↓` smooth-scrolls `#main-content` by 85% of viewport height
- Escape closes the image modal

### Navigation

- Clicking a TOC link calls `goto()` which updates the URL and triggers a `$effect` that loads the new section
- The guide-root breadcrumb (no section) navigates to the first page via the same `$effect` (handles `section = null`)
- Browser back/forward works — `$effect` reacts to the `section` prop changing

### Image Modal

- Click any guide image to open a full-screen modal
- Click anywhere (image, backdrop, or ✕ button) to close
- Escape also closes

### Content Renderer (`GuideBlockRenderer.svelte`)

Renders `ContentBlock[]` recursively. Supported block types:

| Type | Notes |
|------|-------|
| `section` | Boxed h2, bottom-border h3, plain h4 |
| `heading` | Level 1 suppressed (shown in page header instead) |
| `paragraph` | `{@html}` rendered |
| `list` | Recursive ordered/unordered; items are `{ text, children? }` objects |
| `image` | Inline with click-to-modal; local images resolved via `/relay/guides-img/...` |
| `table` | Supports `colspan`/`rowspan`; null cells (from `buildGrid()`) are skipped |

---

## TOC Sidebar

The `_meta.json` can provide either:
- `navTree` — structured tree with `label`, `link`, and `group` node types (groups collapsed by default, toggled via `openGroups` Set)
- `pages` / `nav` — flat list of `{ slug, label }` entries

The active link is highlighted via `gv-toc-link--active` (gold background).

**navTree group nodes with a `slug`:** A group node may have both `slug` and `children`. When it does, the group header renders as a navigable button (`.gv-toc-group-nav`) alongside a separate chevron toggle button (`.gv-toc-chevron-btn`). Groups auto-expand when `currentSlug` matches the group slug or any child slug.

---

## Parser — Content Cleaner (`html-cleaner.js`)

`cleanInlineHtml` sanitises paragraph/list-item HTML before it is stored:

1. Normalises `<b>` → `<strong>`, `<i>` → `<em>`
2. Unwraps `span`, `font`, `small`, `big`, `u`, `s`, `strike`, `sup`, `sub`
3. KEEP_INLINE set: `strong`, `em`, `code`, `a`, `abbr` — everything else is unwrapped
4. Strips all attributes from `strong`/`em`/`code`/`abbr`
5. For `<a>`: keeps only `href`; strips class, style, target, rel, etc. Removes the link entirely (leaves text) if the href is an absolute external URL and `cfg.links.keepExternal` is false
6. Final safety pass: `root.find('[style],[class]').removeAttr(...)` — catches survivors from Cheerio `replaceWith` edge cases (e.g. `<span style="color:…">` wrapping mixed text+elements)

**External vs internal link detection:** A link is external only if its href matches `/^[a-z][a-z0-9+\-.]*:\/\//i` (absolute URI scheme). Bare relative hrefs like `href="wrenwood-hotel"` are treated as internal and preserved.

---

## Source-Specific Conventions

### GameFAQs

- Guide ID: numeric `faqId` extracted from `/faqs/{id}` in URL
- Text-format (ASCII) guides are detected by `isTextGuide($)` and skipped
- Nav tree built from `.ftoc ol` on the first raw page
- `rewriteInternalLinks` rewrites full GameFAQs URLs to bare sibling slugs

### IGN

- Guide ID: wiki slug (e.g. `monster-hunter-stories-3-twisted-reflection`) from `/wikis/{slug}`
- Index page always saved as `_raw/_index.html`; nav tree is built from it
- Sidebar (`.scrollbar`) = genuine nav hierarchy; article body = TOC on index only
- `discoveredFrom` in manifest pages tracks which parent first linked to a child — enables grouped nav tree
- `preprocessRawHtml` normalizes absolute IGN URLs → root-relative so internal links survive `cleanInlineHtml`
- Search uses Puppeteer to scrape IGN wiki search; no API

### Steam

- Guide ID: numeric `publishedfileid` from `?id=` param in `steamcommunity.com/sharedfiles/filedetails/` URL
- Search uses Steam Published File API (`ISteamPublishedFileService/QueryFiles/v1`, `file_type=9`, `query_type=1` for popularity ranking) — **no browser needed**
- Fetcher fetches the single-page guide once with Puppeteer, then cheerio slices it into per-section files
- DOM structure:
  - Sections: `div.subSection[id="{sectionId}"]` inside `div.guide.subSections`
  - Section title: `div.subSectionTitle` | Section body: `div.subSectionDesc`
  - Nav sidebar: `div.rightbox_list_option[id="guideSectionSelection_{sectionId}"]` → `.guideSubSectionSelectionLink`
  - Skip sectionId `"0"` (Overview = show-all default) and `"-1"` (Comments)
- BBCode headings render as `div.bb_h2`, `div.bb_h3` — `preprocessRawHtml` converts to `<h2>`, `<h3>`
- Images are wrapped in `<a class="modalContentLink">` for Steam's popup viewer; `buildAdapter` returns `unwrapSelectors: ['a.modalContentLink']` to strip the wrapper. The `img.src` already points to the full-size Steam CDN URL — no URL transform needed
- Author: `.friendBlockContent` contains "Name\n\t\tOffline" — fetcher takes only the first line
- Each per-section file embeds `div.workshopItemTitle` and `div.friendBlockContent` (cleaned) so `extractTitle`/`extractAuthor` work without re-reading the full raw page
- `extractNavTree` returns a flat link list from `manifest.pages[].label` (original Steam section labels, not slug-ified versions)
- Manifest includes `title` and `author` fields in addition to the standard fields

---

## Parser — GameFAQs Adapter (`gamefaqs/adapter.js`)

### `rewriteInternalLinks`

Rewrites full GameFAQs section URLs to bare sibling slugs:

```
href="/ps5/…/faqs/82414/wrenwood-hotel"  →  href="wrenwood-hotel"
```

Bare slugs resolve correctly from any section URL. The previous `../section/` format was wrong — `..` from a URL without a trailing slash strips two path segments, not one.

### `extractNavTree`

Reads `.ftoc ol` and produces `link`, `group`, and `label` nodes. Handles two `<ol>` child patterns:

- `<li><b>Label</b></li><ol>…</ol>` → `{ type: 'group', label, children }` (non-navigable header)
- `<li><a href="slug">Label</a></li><ol>…</ol>` → `{ type: 'group', label, slug, children }` (navigable parent page with sub-pages; preceding link is promoted to group)

---

## Parser — Auto-Link Pass (`parse-guide.js`)

After `rewriteInternalLinks`, a second pass walks every `list` block and auto-links plain-text list items whose normalized text matches a known section slug.

Normalization: `s.toLowerCase().replace(/[^a-z0-9]/g, '')` — reduces both the item text and the slug+label to pure alphanumeric, bridging gaps like `"Rhodes Hill - The Care Center"` ↔ `rhodes-hill-the-care-center`.

Only items with no existing HTML markup (`!/</.test(item.text)`) and whose target differs from the current page are linked.

---

## Tests (`relay-server/src/tests/guides/`)

### `content-parser.test.js`

73 tests across 18 describe blocks (expanded from 20). New blocks:

- `tables` — basic cell content, colspan, rowspan
- `table grid integrity` — `assertRectangular` helper verifies every row has the same column count and no `undefined` cells
- `pre and code blocks`, `figure`, `blockquote`
- `inline buffer flushing`, `external link policy`
- `br handling` — documents that `behavior: 'keep'` does not preserve `<br>` because `br` is not in KEEP_INLINE
- `isParagraphJunk edge cases`, `empty containers`, `mixed paragraph content`, `deeply nested divs`
- `malformed HTML` — verifies no crash and content is recovered (htmlparser2 does browser-like error recovery)

### `content-file.test.js` (NEW)

File-based structural validator for pre-generated `content.json` files. Run against any NAS file:

```sh
CONTENT_FILE="\\192.168.86.74\app-data\relay\guides\...\content.json" node --test src/tests/guides/content-file.test.js
```

Skips gracefully when `CONTENT_FILE` is not set. 10 assertions: JSON parse, non-empty, valid block types, paragraph html field, heading level+text, section structure, list item shapes, table rectangularity, no undefined cells, full deep structural validation.
