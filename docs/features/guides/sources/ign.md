# IGN Source

IGN wikis are Next.js SSR'd. Guide ID is the wiki slug (e.g. `persona-3-reload`).

## Guide ID & URL shape

```
Index:  https://www.ign.com/wikis/{wikiSlug}
Page:   https://www.ign.com/wikis/{wikiSlug}/{PageTitle}
```

`PageTitle` is Title_Case in the URL but stored on disk as a lowercase kebab `fsSlug` (`titleToSlug`).

## Site DOM structure

```
.wiki-page-container
  div.desktop-wiki-group (first)
    div.wiki-html.content      ← content region
  aside.sidebar
    nav
      div.scrollbar            ← nav links: <a href="/wikis/{slug}/{Page}">
```

Content selector tried in order: `.wiki-html.content` → `.wiki-html` → `.wiki-page-container .content` → `.wiki-page-container`.

## Fetch strategy

Puppeteer (stealth). BFS crawl.

1. Fetch nav-discovery page (index or user-supplied section URL). Wait 1200ms for Next.js hydration, then light scroll.
2. Extract nav links from sidebar (`.scrollbar`) **and** article body (`.wiki-html`) — the index page's body is its TOC.
3. For each queued page: fetch, save `{fsSlug}.html`, then re-scan sidebar+body for new sub-pages not yet seen (`discoveredFrom` set on those entries).
4. After all pages: write `_manifest.json` + `_index.html`.

Non-index pages are scanned sidebar-only by default; `sidebarOnly: false` is used for BFS discovery so body-linked sub-pages are found.

## Parse preprocessing

`preprocessRawHtml` runs before any parse step. It does two things:

**1. URL normalization** — rewrites absolute IGN URLs to root-relative:
```
https://www.ign.com/wikis/slug/Page  →  /wikis/slug/Page
```
Without this, IGN's own internal links look external and get stripped.

**2. Task-card rewriting** — IGN walkthrough pages embed interactive checkbox items as deeply-nested `<span>` trees (`[data-cy="checkbox-view-trigger"]`). Since `<span>` is inline, multiple task items in the same container would get buffered together into one concatenated paragraph. `preprocessRawHtml` uses Cheerio to find each task-card span, extract the task name from `input[type="checkbox"][name]` (fallback: `.task-name` span text), and replace the whole element with `<p class="ign-task">name</p>`.

These `<p>` elements end up as direct children of `<td>` cells inside IGN's day-schedule tables. The generic `cellContent` function in `content-parser.js` detects multiple direct `<p>` children and joins them with `<br>` in the cell's `html` field (falling back to `" / "` in the plain-text `text` field). The guide viewer renders `cell.html` if present, so task items stack vertically within the table cell.

## Image handling

CDN hosts: `oyster.ignimgs.com` and `assets-prd.ignimgs.com`.
`transformImageUrl` strips resize params (`?width=…&format=…&auto=…`) to get full-res originals.
`needsBrowserImageCapture = false` — images are plain HTTP, no session needed.

**Unwrap quirk:** IGN wraps images in `<output class="wiki-image"><button>…<img>…</button></output>`. `junkSelectors` would remove the `<button>`, taking the `<img>` with it. `unwrapSelectors: ['output.wiki-image button']` runs first, promoting the `<img>` out before the button is stripped.

## Nav tree

Built from `.scrollbar` links on the fetched index. If any manifest entry has `discoveredFrom`, those child pages are grouped under their parent (`type: 'group'`); otherwise the tree is flat `type: 'link'` nodes.

## Search strategy

1. **Direct slug probe** — normalizes game name → candidate slugs (`nameToCandidateSlugs`), HEAD-probes `ign.com/wikis/{slug}`, checks page title similarity. Year-aware to avoid landing on older same-named games.
2. **DuckDuckGo fallback** — `site:ign.com/wikis "{gameName}" guide`. Top DDG candidates are then confirmed by probing the live page.

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/guides/ign/adapter.js` | Selectors, title/nav extraction, link rewriting |
| `relay-server/src/services/guides/ign/fetcher.js` | Puppeteer BFS, manifest |
| `relay-server/src/services/guides/ign/search.service.js` | Slug probe + DDG fallback |

## Gotchas

- `preprocessRawHtml` must run before parse — IGN pages embed absolute `ign.com` URLs in their HTML even for internal links. Both the URL normalization and task-card rewriting happen there (see Parse preprocessing above).
- BFS discovers sub-pages by scanning both sidebar and body on every page (as of June 2026 fix — previously sidebar-only missed child pages linked only from article bodies).
- `fsSlug` is always lowercase kebab-case; the URL's `PageTitle` can be mixed-case. `titleToSlug` handles the conversion; `rewriteInternalLinks` uses `knownSlugs` fuzzy matching for slight capitalisation variations.
- The index page is saved separately as `_index.html` even when a section URL was used to start the crawl, so title extraction always has a stable source.
