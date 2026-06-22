# Guides

## Overview

The guides system allows parsed GameFAQs (and future) guides to be stored on the NAS and surfaced in the gaming journal. Each guide is associated with a Steam App ID and a source name (e.g. `gamefaqs`).

---

## Data Storage

Guides live on the NAS at:
```
\\192.168.86.74\app-data\relay\guides\{steamId}\{source}\
```

Each source folder contains:
- `_meta.json` — guide metadata (title, author, nav tree, pages list, parsedAt)
- One folder per section slug, each containing `content.json` and any images in `img/`

### Steam ID Mapping

The folder name must match the game's **current** Steam App ID. Notable cases:
- `3375780` — Trails in the Sky 1st Chapter (remake; NOT 251150 which is the 2014 classic)
- `2072450` — Like a Dragon: Infinite Wealth
- `3764200` — Resident Evil Requiem
- `920210` — LEGO Star Wars: The Skywalker Saga

---

## Relay API

Endpoints served by the relay server (`relay-server/src/controllers/guides/guides.controller.js`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/guides/:steamId` | List all guide sources for a game |
| GET | `/api/guides/:steamId/:source/meta` | Full `_meta.json` for a guide |
| GET | `/api/guides/:steamId/:source/:section` | `content.json` for a section |

Static images are served at:
```
/guides-img/{steamId}/{source}/{section}/img/{filename}
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
