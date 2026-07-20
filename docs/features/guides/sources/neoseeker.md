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

0. **Lightbox images → `<figure>`** (`promoteLightboxImages`, cheerio) — Neoseeker wraps
   *every* content image in `<a class="image photoswipe">`. `<a>` is not in the content
   parser's `BLOCK_TAGS`, so the walker buffers the whole anchor as inline HTML and
   `cleanInlineHtml` then deletes the `<img>` — it isn't in `KEEP_INLINE`, and a void
   element's innerHTML is `""`. This silently dropped **100% of images on every Neoseeker
   guide**. Rewriting the anchor to `<figure><img></figure>` puts it on the parser's
   figure branch. Full-size src comes from `data-full_image`, which Neoseeker carries on
   the **`<a>`, never on the `<img>`** (verified 1904/1904 vs 0/1908 across all 7 cached
   guides). Runs first so the lightbox `href="…/File:Foo.jpg"` is consumed before pass 1
   turns it into a dead `File:…` slug.

   Two carve-outs:
   - `a.image.no-cursor` (wrapping `img.img-icon`) is left alone — those are ~12-24px
     mid-sentence glyphs (chest markers, button prompts), not figures. The class pairing
     is an exact 1:1 discriminator corpus-wide. They are still dropped by the inline
     cleaner; preserving them would need `img` in `KEEP_INLINE`, which affects all sources.
   - A `<p>` containing a promoted figure is re-tagged `<div>`. `<figure>` inside `<p>` is
     invalid nesting, and when the paragraph also carries text the parser takes its inline
     path and drops the image again. `div` is a generic block wrapper the walker recurses
     into, so text and images both survive in document order.

1. **Absolute URL → bare slug** — rewrites `https://www.neoseeker.com/{gameSlug}/{page}` → `{page}` before parse, so `cleanInlineHtml` doesn't strip them as external links.

2. **Thumbnail URL strip** — thumbnail URLs pass 0 didn't resolve (images with no lightbox
   anchor, plus the unpromoted inline icons) have the `/thumb/{hash}/…/NNNpx-{filename}`
   segment stripped to get the base CDN URL.

> A prior pass that read `data-full_image` off the `<img>` was removed — it matched 0 of
> 1908 images across the corpus, because the attribute only ever sits on the parent `<a>`.
> Pass 2 was doing all the full-size resolution by accident.

### Images inside data tables

Images in cells of a **data table** (one with `<th>`/`<thead>`) used to be lost — they
became alt text via `cellContent`'s image-only fallback. Fixed in the shared parser via
the table cell `image` field; see `docs/server/guides/parsing.md`. This was never
Neoseeker-specific — Game8 was losing images to it too.

Recovered on an 8-page sample per guide: `assassins-creed-black-flag-resynced` 53 (of 122
total) and `fantasy-life-i` 72 (of 164). Layout tables were never affected — the parser
recurses into their cells and emits normal image blocks.

Neoseeker's 12-24px `img-icon` glyphs frequently sit in data-table cells next to text
(one page has 348). Those are skipped by the parser's glyph-size threshold, so they do
not become block images.

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
