# Guide Sources & Adapter Contract

Each guide source (IGN, GameFAQs, Steam, Game8, Gamer Guides, Fandom, Neoseeker) has two files: a **fetcher** (Puppeteer BFS → raw HTML on disk) and an **adapter** (site-specific selectors + metadata extraction). The shared `parse-guide.js` tool calls into the adapter; the raw HTML never needs re-fetching to re-parse.

**Per-source detail docs** — DOM structure, fetch strategy, preprocessing, search mechanism, gotchas:
[IGN](sources/ign.md) · [GameFAQs](sources/gamefaqs.md) · [Steam](sources/steam.md) · [Game8](sources/game8.md) · [Gamer Guides](sources/gamerguides.md) · [Fandom](sources/fandom.md) · [Neoseeker](sources/neoseeker.md)

Interactive **maps** are a separate pipeline with its own adapters — no HTML parsing, no `parse-guide.js`. Two sources: IGN (Map Genie) and Game8. See [map-sources.md](map-sources.md).

## Adapter contract

Every adapter must export:

```js
resolveContentSelector($)           // → string: CSS selector for main content area
buildAdapter(contentSelector)       // → { contentSelector, unwrapSelectors, junkSelectors, transformImageUrl? }
extractTitle($)                     // → string | null: guide/game title
extractNavTree($, guideId, pages?)  // → NavItem[] | null
slugToLabel(slug)                   // → string: slug → display label
rewriteInternalLinks(html, guideId, knownSlugs?) // → string: rewrite internal hrefs to slug form
```

Optional / source-specific:

```js
preprocessRawHtml?(html, guideId)   // → string  (IGN: normalize absolute URLs before parse)
extractNavLinksFromDoc?($, slug, baseUrl, opts?)  // → PageLink[]  (IGN fetcher uses this)
isTextGuide?($)                     // → boolean  (GameFAQs: detect ASCII-art guides)
extractAuthor?($)                   // → string | null  (GameFAQs, Steam)
needsBrowserImageCapture            // boolean export (IGN = false; others vary)
imageRootSelector                   // string export: CSS selector for image discovery
```

`buildAdapter` returns the descriptor used by `html-cleaner.js`:
- `unwrapSelectors` — elements to replace with their children (before junk removal)
- `junkSelectors` — elements to remove entirely (ads, site chrome, nav rails)
- `transformImageUrl` — optional function applied to each image `src` before download

## Source details

### IGN
- **Guide ID**: wiki slug (e.g. `persona-3-reload`)
- **Structure**: Next.js SSR wiki. Content in `.wiki-html.content`. Sidebar nav in `aside.sidebar > nav > div.scrollbar`.
- **BFS**: Starts from index page; scans sidebar + article body. On non-index pages, scans sidebar AND article body (as of June 2026 fix — previously sidebar-only caused missing child pages).
- **Images**: `oyster.ignimgs.com` and `assets-prd.ignimgs.com` CDN. `transformImageUrl` strips resize params (`?width=…&format=…`) to download full-res originals. No Puppeteer image capture needed (`needsBrowserImageCapture = false`).
- **Key quirk**: `preprocessRawHtml` normalizes absolute IGN URLs (`https://www.ign.com/wikis/slug/page`) to root-relative (`/wikis/slug/page`) before parsing, so they're treated as internal links rather than stripped as external.

### GameFAQs
- **Guide ID**: numeric `faqId` (from `/faqs/{id}` in URL)
- **Structure**: Traditional HTML. Content in `.main-content`. Nav from `.ftoc` on first raw page.
- **Text guide detection**: `isTextGuide($)` checks for ASCII-art FAQ format. Text guides are skipped at fetch time — only HTML guides are downloaded.
- **Author**: Extracted from `.faq-header .author` or similar; stored in manifest and `_meta.json`.
- **Key quirk**: Multiple pages are separate HTML documents (not a wiki). Each page is fetched and saved individually.

### Steam
- **Guide ID**: numeric `publishedfileid` (from `?id=` in URL)
- **Structure**: Single Puppeteer fetch of the full guide page; cheerio then slices it into per-section files by `div.subSection[id="{sectionId}"]`.
- **Nav**: Built from `div.rightbox_list_option[id="guideSectionSelection_{sectionId}"]` elements. Skip section IDs `"0"` (Overview = show-all) and `"-1"` (Comments).
- **BBCode**: `div.bb_h2`, `div.bb_h3` in raw HTML → `preprocessRawHtml` converts to `<h2>`, `<h3>` before parsing.
- **Images**: Wrapped in `<a class="modalContentLink">` → `unwrapSelectors` strips the wrapper; `img.src` already points to full-size Steam CDN.
- **Author/Title**: `div.workshopItemTitle` + `div.friendBlockContent` (first line only — strip "\nOffline" etc.). Both included in every per-section file so extractors work on any page.
- **Search**: Uses Steam Published File API (`ISteamPublishedFileService/QueryFiles/v1`), `file_type=9`, `query_type=1` (popularity sort). No browser needed.

### Game8
- **Guide ID**: game slug from `game8.co/games/{slug}` URL
- **Structure**: Article-style HTML. Content extracted via Game8-specific selectors.
- **Search**: Puppeteer — searches game8.co, finds the game's guide hub, returns the URL.

### Gamer Guides
- **Guide ID**: slug from `gamerguides.com/{slug}/guide`
- **Structure**: Multi-chapter HTML guides.
- **Search**: No browser — slug is inferred from game name (kebab-case) and verified with an HTTP HEAD check.

### Fandom
- **Guide ID**: composite `{subdomain}--{articleSlug}` (e.g. `persona-3-reload--Walkthrough`)
- **Structure**: MediaWiki HTML. Content in `.mw-parser-output`.
- **Search**: Puppeteer — searches fandom.com, identifies the relevant subdomain wiki.

### Neoseeker
- **Guide ID**: game slug from `neoseeker.com/{slug}/walkthrough`
- **Structure**: HTML walkthrough pages.
- **Search**: Puppeteer — searches neoseeker.com for the game's walkthrough page.

## ContentBlock schema

All adapters produce the same ContentBlock[] output in `content.json`:

| type | fields |
|------|--------|
| `paragraph` | `{ type, html }` — html may contain `<a href="slug">` internal links |
| `heading` | `{ type, level, text, id }` |
| `list` | `{ type, ordered, items: [{ text, html?, children? }] }` |
| `image` | `{ type, alt, localSrc }` — `localSrc` is relative `img/001.webp`; null if not downloaded |
| `video` | `{ type, provider, videoId, url, thumb, caption? }` — `thumb` is an image block (the poster frame). See [videos.md](videos.md) |
| `table` | `{ type, caption?, headers, rows }` — cells: `{ text, html?, colspan?, rowspan? }` |
| `section` | `{ type, level, heading, id, children: ContentBlock[] }` — wraps a heading + its content |

Use `html` on table cells when the cell contains links (otherwise `text` is sufficient).

## NavTree schema (in `_meta.json`)

```js
{ type: 'link',  slug, label }
{ type: 'group', slug?, label, children: NavItem[] }
{ type: 'label', label }                             // GameFAQs only
```

Groups are formed when `manifest.pages[].discoveredFrom` identifies a parent. The `discoveredFrom` field is set during BFS when a sub-page is first discovered from a parent page's sidebar or (IGN) article body.

## Common questions

**Q: How do I re-parse a guide after fixing an adapter without re-fetching?**
Run `node src/tools/parse-guide.js --steam-id {id} --source {src} --guide-id {id} --no-images`. Raw HTML is already on disk. `--no-images` skips re-downloading images that are already in `img/`.

**Q: How do I add a new source?**
1. Create `src/services/guides/{source}/adapter.js` (implement the contract above)
2. Create `src/services/guides/{source}/fetcher.js`
3. Create `src/services/guides/{source}/search.service.js`
4. Wire into `fetch-guide.js`, `parse-guide.js`, and `guides.controller.js`
5. Add source label/icon to UI constants in `JournalDashboard.svelte` and `GuidesModal.svelte`

**Q: Why does IGN use `preprocessRawHtml` but GameFAQs doesn't?**
IGN pages contain absolute `https://www.ign.com/wikis/…` URLs in their HTML. Without normalization, `rewriteInternalLinks` wouldn't match them (it expects root-relative `/wikis/…` form). GameFAQs links are already root-relative.

## Gotchas

- **Parse-guide is idempotent** — re-running it overwrites `content.json` and `_meta.json` but doesn't delete existing `img/` files. Images not re-downloaded retain their `localSrc`.
- **`_fulltext.json` is NOT regenerated by parse-guide** — delete it manually after re-parsing if you need fresh full-text search data.
- **Adapter `junkSelectors` run after `unwrapSelectors`** — order matters. If you need to preserve content inside a normally-junk element (e.g. an image inside a `<button>`), add an `unwrapSelector` to promote the content first.
- **`knownSlugs` in `rewriteInternalLinks`** — passed as a `Set<string>` of all fetched page slugs. Used for fuzzy slug correction when the link's slug doesn't exactly match any fetched page (e.g. capitalisation or underscore differences).
