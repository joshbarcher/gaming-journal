# Gamer Guides Source

Gamer Guides is a structured multi-chapter guide site. Guide ID is the game slug. TOC is fully server-rendered.

## Guide ID & URL shape

```
Index:  https://www.gamerguides.com/{gameSlug}/guide
Page:   https://www.gamerguides.com/{gameSlug}/guide/{section}/{subsection}/{page}
```

Guide ID = `gameSlug` (e.g. `elden-ring`). Page slugs encode the full path with `--` as separator:
```
gameplay/tips-and-tricks/best-class  →  gameplay--tips-and-tricks--best-class
```

## Site DOM structure

```
.guide-page-content     ← article body  ← content selector
.guide-sidebar          ← left TOC sidebar (stripped as junk)
.guide-helper-menu      ← top prev/next nav bar (stripped as junk)
```

Content selector tried in order: `.guide-page-content` → `article` → `main`.

## Fetch strategy

Puppeteer (stealth). TOC-seeded linear fetch. Max 600 pages.

1. Fetch `/{gameSlug}/guide` index page; save as `_index.html`.
2. `extractTocLinks` scans all `a[href^="/{gameSlug}/guide/"]` links. Categorizes by path depth:
   - 1 path segment (e.g. `/guide/gameplay`) — section group header, skipped for download
   - 2+ path segments (e.g. `/guide/gameplay/tips`) — leaf page, queued for download
3. Group label = first path segment, title-cased.
4. Download each leaf page; write `{slug}.html`.
5. Write `_manifest.json` with `{ slug, label, group, href, file }`.

## Parse preprocessing

Two transforms in `preprocessRawHtml`:

1. **Image block rewrite** — `.image-block` divs contain `<picture><img data-orig-src="…">` with an optional `.image-block-caption`. Rewrites to `<figure><img src="…"><figcaption>…</figcaption></figure>` so the content parser's figure handler captures them:
   ```
   <div class="image-block">…data-orig-src="real.jpg"…</div>
   →  <figure><img src="real.jpg">…</figure>
   ```

2. **Database link stripping** — Links to `/{gameSlug}/database/…` or `/premium/…` are replaced with their text content. These point to GG's item database, not guide pages, and break navigation in the app.

## Image handling

`needsBrowserImageCapture = false` — `data-orig-src` carries the full-res URL and is promoted to `src` in step 1 above. Images serve from Gamer Guides CDN via plain HTTP.

## Nav tree

Built from manifest pages with groups. `slugToLabel` uses ` › ` for `--` separators:
```
gameplay--tips-and-tricks--best-class  →  "Gameplay › Tips And Tricks › Best Class"
```

## Search strategy

HTTP HEAD probe — no browser needed. Game slug is inferred from the game name (kebab-case conversion) and verified with a HEAD request to `gamerguides.com/{slug}/guide`. Returns the URL if the slug resolves.

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/guides/gamerguides/adapter.js` | Selectors, image rewrite, database link stripping, nav |
| `relay-server/src/services/guides/gamerguides/fetcher.js` | Puppeteer TOC-seeded fetch |
| `relay-server/src/services/guides/gamerguides/search.service.js` | HEAD-probe search |

## Gotchas

- Parent section links (1 path segment) are in the TOC but are **not downloaded** — only leaves (2+ segments) get a file. The group label is derived from the first segment's text, title-cased.
- `.heading-permalink` elements contain a `¶` character and are stripped by the junk selector. They're also removed from `h1` before `extractTitle` so the title text is clean.
- `rewriteInternalLinks` rewrites guide-path links to `--`-joined slugs. Non-guide links (database, premium) are handled in `preprocessRawHtml` instead, before the link rewriter runs.
- The `_index.html` file stores the full TOC and is used by parse-guide.js to build the nav tree (via manifest, not DOM — manifest already carries group/label).
