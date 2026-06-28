# Fandom Source

Fandom wikis are MediaWiki-based and fully server-rendered. Guide ID encodes both the wiki subdomain and the starting article.

## Guide ID & URL shape

```
Article: https://{subdomain}.fandom.com/wiki/{ArticleTitle}
```

Guide ID = `{wikiSubdomain}--{articleSlug}` (e.g. `persona--Persona_3_Reload`).
`articleSlug` uses underscores, matching the URL's `ArticleTitle` form.
The guide ID is set from the start article's slug when the manifest is written.

## Site DOM structure

MediaWiki. Content is always in:
```
.mw-content-ltr.mw-parser-output    ← primary selector
.mw-parser-output                   ← fallback
#mw-content-text                    ← fallback
```

Namespace links (Category, File, Special, Template, etc.) are skipped everywhere — same `SKIP_NS_RE` used in both fetcher and adapter.

## Fetch strategy

Puppeteer (stealth), single reused page instance for performance (open/close per article was the bottleneck). BFS from the start article. Max 700 pages. Short 300ms delays between requests.

1. Parse `wikiSubdomain` from the hostname; extract `startArticle` from `/wiki/{title}`.
2. BFS: fetch each article page, save `{titleToSlug(article)}.html` (spaces → `_`, unsafe chars → `-`).
3. After each page: scan `.mw-parser-output a[href^="/wiki/"]` for new article titles to enqueue. Skip namespace links.
4. Copy start page to `_index.html`.
5. Write `_manifest.json` with `{ slug, file, label, url }` per page.

## Parse preprocessing

`preprocessRawHtml` strips Fandom's CDN resize transform from image URLs:
```
https://static.wikia.nocookie.net/…/File.png/revision/latest/scale-to-width-down/1000?cb=…
→  https://static.wikia.nocookie.net/…/File.png/revision/latest?cb=…
```
The transform segment between `/revision/latest` and `?cb=` is removed to get the full-resolution image.

## Image handling

`needsBrowserImageCapture = false`. Images are on `static.wikia.nocookie.net` CDN and serve over plain HTTP.

## Nav tree

Flat, built from manifest pages (`type: 'link'` list). Fandom wikis have no collapsible sidebar hierarchy — all downloaded pages are treated as peers.

## Internal link rewriting

`rewriteInternalLinks` uses cheerio to process each `<a href>` individually:
- **Known page** → `href="{slug}{#fragment}"` (relative)
- **Unknown page** (not in downloaded set) → live wiki URL with `target="_blank"`, `rel="noopener noreferrer"`, class `gv-link-external`
- **Namespace link** → `href` removed (non-navigable)

This is more sophisticated than regex rewriting because it needs to add classes and attributes.

## Search strategy

Puppeteer — searches `fandom.com` to identify the correct wiki subdomain for the game.

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/guides/fandom/adapter.js` | Selectors, CDN image rewrite, cheerio link rewriting |
| `relay-server/src/services/guides/fandom/fetcher.js` | Puppeteer BFS, single reused page |
| `relay-server/src/services/guides/fandom/search.service.js` | Fandom site search |

## Gotchas

- Page slugs use underscores (`_`), not hyphens. `slugToLabel` replaces `_` with space. `titleToSlug` converts spaces→`_` and illegal filesystem chars→`-`.
- The guide ID's `articleSlug` part is the **start article's slug** (from `_index.html`), not the wiki name. Two guides on the same wiki have different guide IDs.
- Pages not in the downloaded set get live wiki URLs, not `#` — this means users can follow links to undownloaded content in a browser tab.
- `MAX_PAGES = 700` is high because some game wikis have hundreds of relevant pages (item lists, character pages, etc.). Be aware that a Fandom guide can take a long time to fetch.
- `isTextGuide()` always returns `false` — Fandom wikis don't have text/ASCII guide format.
