# Neoseeker Source

Neoseeker is MediaWiki-based and Cloudflare-protected. Guide ID is the game slug. The index page is always `walkthrough`.

## Guide ID & URL shape

```
Index: https://www.neoseeker.com/{gameSlug}/walkthrough
Page:  https://www.neoseeker.com/{gameSlug}/{PageTitle}
Sub:   https://www.neoseeker.com/{gameSlug}/{section}/{PageTitle}
```

Guide ID = `gameSlug` (e.g. `resident-evil-requiem`). Page slugs are Title_Case with underscores (e.g. `Wrenwood_Hotel_(Grace)`). `walkthrough` is always the index slug, displayed as "Introduction".

## Site DOM structure

MediaWiki, but with Neoseeker's wrapper:
```
#wiki-content                   ← content region  ← primary selector
  .section-spaced
    .mw-parser-output           ← actual article content
.wiki-toc                       ← TOC (stripped as junk after nav extraction)
```

Content selector tried in order: `#wiki-content` → `.mw-parser-output` → `#mw-content-text` → `article`.

**Note:** `#wiki-content` itself carries `class="social_share"`. The junk selector is `.social_share:not(#wiki-content)` — targeting `#wiki-content` directly would strip the entire content region.

## Fetch strategy

Puppeteer (stealth), single reused page instance. 429 exponential backoff (5s × 2^attempt). 1200ms delays between pages.

1. Fetch `/{gameSlug}/walkthrough` as the index; save as both `walkthrough.html` and `_index.html`.
2. Seed BFS queue from `.wiki-toc` links (`tocOnly: true`). Also scan index content for additional links.
3. BFS: fetch each queued page, save `{safeFilename(slug)}.html`, scan content + TOC for new links.
4. Write `_manifest.json`. `walkthrough` entry is always first with label "Introduction".

`safeFilename` replaces `\ / : * ? " < > |` with `_` for Windows-safe filenames. The slug itself keeps the original characters for URL matching.

## Parse preprocessing

Three passes in `preprocessRawHtml`:

1. **Absolute URL → bare slug** — rewrites `https://www.neoseeker.com/{gameSlug}/{page}` → `{page}` before parse, so `cleanInlineHtml` doesn't strip them as external links.

2. **Full-res image via `data-full_image`** — thumbnail CDN URLs on `cdn.staticneo.com/ew/thumb/…` are replaced with `data-full_image` attribute value (the original full-size URL).

3. **Thumbnail URL strip** — any remaining thumbnail URLs not covered by pass 2 have the `/thumb/{hash}/…/NNNpx-{filename}` segment stripped to get the base CDN URL.

## Nav tree

`extractNavTree` reads `.wiki-toc` on the index page (`_index.html`). Handles:
- `li.heading` — section label divider
- `li > ul` — accordion group (trigger link may be a navigable page → gets `slug` on group node)
- `li > a` — plain link

`walkthrough` is always prepended as `{ type: 'link', slug: 'walkthrough', label: 'Introduction' }`.

## Internal link rewriting

`rewriteInternalLinks` uses cheerio. For each `<a href>`:
- **Known slug** → `href="{slug}{#fragment}"`
- **Unknown slug** → `href` removed, class `gv-link-unavailable`, `title="Page not in guide"`

Handles both absolute `https://www.neoseeker.com/{slug}/{page}` forms and bare slugs pre-converted by `preprocessRawHtml`.

## Search strategy

Puppeteer — searches `neoseeker.com` for the game's walkthrough page.

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/guides/neoseeker/adapter.js` | Selectors, 3-pass preprocessing, wiki-toc nav extraction |
| `relay-server/src/services/guides/neoseeker/fetcher.js` | Puppeteer BFS, 429 retry, safe filename handling |
| `relay-server/src/services/guides/neoseeker/search.service.js` | Neoseeker site search |

## Gotchas

- `slug` and `file` differ when the slug contains illegal filename chars — use `slug` for URL construction and `file` for disk reads.
- Sub-pages at `/{gameSlug}/{section}/{page}` (3-part paths) use only `{page}` as the slug (the section prefix is discarded). This can cause slug collisions if two sections have a page with the same name.
- The TOC uses accordion `<ul>` groups that span multiple `<ul>` elements within `.wiki-toc` — `extractNavTree` iterates over each `ul` independently, accumulating state across them.
- If `extractGuideLinks` finds 0 TOC pages, the fetcher logs a warning but continues — the crawl will rely on content links only.
- `extractAuthor` reads from JSON-LD (`application/ld+json`), not DOM elements — guides don't have a visible author byline.
