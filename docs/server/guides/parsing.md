# Guide Parsing

CLI tool that converts raw HTML guide pages into structured JSON (nav tree + content blocks) plus a preview page. Spawned as a child process by the job queue after fetching, or run directly to re-parse.

## Data flow

1. Spawned as `parse-guide.js --steam-id <id> --source <src> --guide-id <id> [--no-images] [--force] [--keep-external-links] [--keep-br]`.
2. Reads `_raw/_manifest.json` and the `_raw/*.html` pages under `guides/{steamId}/{source}/{guideId}/`.
3. Dynamically imports the source adapter (`{source}/adapter.js`; unrecognized → `gamefaqs`).
4. Per page: `preprocessRawHtml` (opt-in) → `html-cleaner.js` cleans + isolates the content DOM → `content-parser.js` walks it into a flat `ContentBlock[]` → (opt-in) `jump-links.js` merges TOC anchor lists → `sectionize.js` nests blocks under `section` wrappers keyed by heading id.
5. Unless `--no-images`: `image-downloader.js` downloads referenced images, then `images.js` (`convertImgDir`) converts them to WebP.
6. Internal links are rewritten (`rewriteInternalLinks`), plain-text list items matching a known slug are auto-linked, and refs to pages that failed to parse this run are downgraded to `<span class="gv-keyword">`.
7. Per page writes `{safeSlug}/content.json` and `{safeSlug}/preview.html`. Guide-level writes `_meta.json` and `_fulltext.json`.
8. Progress emitted as `[PROGRESS] {"bar":"pages"|"subtask",…}`; the queue parses it. `parse-guide.js` forces `process.exit(0)` after flushing (undici keep-alive sockets otherwise leave the job stuck at 100%).

### CLI flags
`--steam-id`, `--source`, `--guide-id` required. `--no-images` skips downloading *new* images (existing ones still resolve `localSrc`). `--force` re-downloads images on disk. `--keep-external-links` keeps external `<a>` instead of unwrapping to text. `--keep-br` leaves `<br>`.

### Adapter contract
Each `{source}/adapter.js` exports (required):
```
resolveContentSelector($)                        → string
buildAdapter(contentSelector)                    → { contentSelector, unwrapSelectors, junkSelectors, transformImageUrl? }
extractTitle($)                                  → string | null
extractNavTree($, guideId, manifestPages?)       → NavItem[] | null
slugToLabel(slug)                                → string
rewriteInternalLinks(html, guideId, knownSlugs?) → string
```
Optional (each falls back when absent):
```
isTextGuide($)              → boolean    // gamefaqs — skip ASCII-art guides
extractAuthor($)            → string|null
preprocessRawHtml(html,id)  → string     // ign, thegamer — relativize absolute internal URLs before parse
extractNavLinksFromDoc(...)  → PageLink[] // infer parent/child from local files
extractSidebarBranch($,id) + buildNavTreeFromBranches(...)  // ign — rebuild TOC by unioning per-page sidebar branches
jumpLinks                   → boolean    // opt into the jump-links pass
```
Sources: `gamefaqs`, `ign`, `steam`, `game8`, `gamerguides`, `fandom`, `neoseeker`, `thegamer`. `gamefaqs` is the fallback for an unrecognized `--source`.

### ContentBlock types
`content.json` holds five types: `section`, `paragraph`, `list`, `image`, `table`.
- `section` — `{ type, level, heading, id, children[] }`. Produced by `sectionize.js`; `id` is the slugified heading.
- `paragraph` — `{ type, html }`, inline-safe HTML.
- `list` — `{ type, ordered, items }`; each item `{ text, children?: { ordered, items } }`; `text` is inline HTML. May carry `variant: 'jumplinks'`.
- `image` — `{ type, src, alt, caption?, localSrc? }`; `localSrc` is guide-relative `img/001.jpg`.
- `table` — `{ type, caption?, headers, rows }`; cells `{ text, html?, image?, colspan?, rowspan? }` or `null` where span-covered.
  - `image` — `{ type:'image', src, alt, localSrc? }`, the same shape as an `image` block, for an image living inside a cell. Cells are otherwise text-only, so before this the image was dropped and only its alt text survived — image-heavy wiki guides keep a large share of their screenshots in data tables (Neoseeker, Game8). Attached on **every** `cellContent` branch, so a cell pairing a screenshot with a label keeps both; `text`/`html` are unchanged.
  - Images whose markup states a width **or** height ≤ 48px are treated as inline glyphs (item/button icons sitting beside cell text) and skipped — promoting them would swamp the table. With no stated size the image is kept.
  - Only **one** image per cell is captured: the first *non-glyph* one. Multi-image cells are real and common — measured across the cache: Neoseeker 94 (cells of up to 7 images), Game8 17, Fandom 2 — but the extras are almost always glyphs, so exactly **2 real images corpus-wide** are dropped by the one-per-cell model. Capturing more would need an array in the schema plus both renderers; not worth it at that volume.
  - Selecting the first non-glyph image (rather than the first image, then testing it) matters: icons do not reliably come last, so a first-image test would return `null` and lose a screenshot sitting behind an icon. That ordering does not occur in the current cache, but nothing prevents it.

**Collecting images for download:** use `collectImageBlocks(blocks)` from `content-parser.js`, never `blocks.filter(b => b.type === 'image')` — the latter misses cell images. It returns live references in document order, so `downloadImages` sets `localSrc` on cell images in place through the same path as top-level ones.

`content-parser.js` also emits an intermediate `heading` (`{ type, level, text }`), but `sectionize()` consumes every heading into a `section` wrapper, so none reach `content.json`. No `code`/`tip`/`warning`/`note` blocks — `<pre>`/`<code>` become paragraphs.

## Jump links (in-page TOCs)
`jump-links.js` merges consecutive bullet lists of pure `#fragment` anchors into one block tagged `variant: 'jumplinks'` (rendered as a horizontal pill row). Stays `type: 'list'` with the same item shape, so fulltext/search/preview need no change. Runs on the flat array **before `sectionize()`**. It also repairs anchors: since a link's label *is* the target heading text, a missing fragment is re-derived from it — but only when the original misses and the re-derived hits. **Opt-in per source** (`export const jumpLinks = true`) — the shape false-positives easily. **Currently enabled: `thegamer` only.** game8 is a deferred candidate (~9,900 anchors across 4 guides, ~93% already resolve).

## Link handling, why order matters
`html-cleaner.js` strips any `<a>` whose href carries a URI scheme (`https://…`) to its text **during parsing, before** `rewriteInternalLinks`. So an adapter whose source emits *absolute* internal links must relativize them in `preprocessRawHtml` first (ign: `ign.com/wikis/…`→`/wikis/…`; thegamer: `thegamer.com/foo/`→`/foo/`). fandom's hrefs are already relative. `rewriteInternalLinks` then classifies survivors per source: in-guide target → bare slug (fragment kept); fandom → absolute live URL + `target="_blank"` + `gv-link-external`; thegamer → `<span class="gv-keyword">`. An in-guide href must never survive as root-relative (`/author/…`) — the SPA would route to a nonexistent page. Rewriting runs on `paragraph.html`, list-item `text`, and table-cell `html` using cheerio **fragment mode** (`cheerio.load(html, opts, false)`).

### TheGamer related-article BFS
`thegamer/fetcher.js` walks articles the prose links to, breadth-first, storing them `related: true`; `extractNavTree` files them under `Related Articles`. Harvesting is scoped to the content region (junk selectors applied) — scanning raw HTML pulls in site chrome. The walk needs a **topic bound** or it eats the site. Two-tier: a fast path accepts an article tagged with a guide root tag (learned via `rootTagsOf`, ≥10% of directory pages) **or** whose slug starts with the base prefix; a fast-path *miss* is probed (fetched + judged by its own tag strip) up to `MAX_TOPIC_PROBES`, because the tag index only paginates ~250 recent articles. Results are cached in `_raw/_crawl-cache.json` (written in a `finally`): dead slugs (retried after `DEAD_RETRY_DAYS`=30), the tag allowlist (`ALLOWLIST_TTL_DAYS`=7), per-page derived links/tags (keyed on HTML mtime/size), and offTopic verdicts (dropped when root tags change). `--force` ignores the cache. **Failure mode:** `makeTopicFilter` falls back to prefix-only when the allowlist is empty, so a rotted card selector *looks like a working, narrower crawl* — if the allowlist size looks small, suspect the selector.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/guides/tools/parse-guide.js` | CLI entry, adapter dispatch, link rewrite, `_meta.json`/`_fulltext.json`/`preview.html` |
| `src/lib/server/relay/guides/{source}/adapter.js` | Per-source selectors, title/nav extraction, link rewriting |
| `src/lib/server/relay/guides/parser/html-cleaner.js` | Strip boilerplate/ads/nav, normalize inline HTML |
| `src/lib/server/relay/guides/parser/content-parser.js` | Cleaned DOM → flat `ContentBlock[]` |
| `src/lib/server/relay/guides/parser/sectionize.js` | Flat blocks → nested `section` tree; owns `headingId()` |
| `src/lib/server/relay/guides/parser/jump-links.js` | Merge + repair in-page TOC anchor lists (opt-in) |
| `src/lib/server/relay/guides/parser/image-downloader.js` | Download images referenced by `image` blocks |
| `src/lib/server/relay/guides/images.js` | Convert downloaded images to WebP |

## Storage layout

```
{RELAY_DATA_ROOT}/guides/{steamId}/{source}/{guideId}/
  _raw/                     ← input (see fetching.md)
  _meta.json                ← title, author, nav, navTree, pages, coverImages, sizeBytes, parsedAt
  _fulltext.json            ← [{ slug, label, text, blockPath }] for in-guide Fuse.js search
  {safeSlug}/
    content.json            ← ContentBlock[] for this page
    preview.html            ← standalone visual-check page
    img/                    ← downloaded + WebP images
```

Images are served by `GET /relay/guides-img/{steamId}/{source}/{guideId}/{safeSlug}/img/{file}` (`serveStatic` over `featureDir('guides')`, with Range/ETag/traversal handling).

## Common questions

**Q: What is a NavTree?**
A hierarchical node list in `_meta.json`. Nodes: `{ type:'link', slug, label }`, `{ type:'group', slug, label, children }`, `{ type:'label', label }`. The guide viewer renders the sidebar from it.

**Q: How do I re-parse without re-fetching?**
Run `parse-guide.js` directly against the existing `_raw/` (it never hits the network):
```
node --env-file .env src/lib/server/relay/guides/tools/parse-guide.js \
  --steam-id 1687950 --source thegamer --guide-id persona-5-royal-complete-guide-walkthrough --no-images
```
The job queue always fetches before parsing — there is no skip-fetch path through it.

## Gotchas

- `--no-images` only skips *new* downloads; existing images still resolve `localSrc` — the right flag for a re-parse.
- Data-integrity guard: a run yielding 0 sections, or <50% of a prior successful parse, throws and leaves the good `_meta.json`/`_fulltext.json` untouched (treats it as a transient failure). Prior `coverImages`/`navTree` are preserved when a run derives none.
- `[PROGRESS]` protocol is exact: `[PROGRESS] ` then one line of JSON. Bars: `pages` (primary), `subtask` (per-page).
- Page/section directory names are the slug with `\ / : * ? " < > |` → `_`. A slug carrying `#anchor` maps to the base-slug directory; the parser slices the page to just that anchor's section.
- If an adapter throws mid-parse, later pages aren't written and the job is marked `failed`; `_raw/` stays intact for a retry.
