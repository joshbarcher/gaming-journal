# GameFAQs Source

GameFAQs HTML guides only (text/ASCII guides are detected and skipped). Guide ID is a numeric `faqId`.

## Guide ID & URL shape

```
Guide:   https://gamefaqs.gamespot.com/{platform}/{gameId}-{slug}/faqs/{faqId}
Section: https://gamefaqs.gamespot.com/{platform}/{gameId}-{slug}/faqs/{faqId}/{section}
```

`faqId` is the numeric identifier (e.g. `82117`). Sections are bare slugs like `introduction`, `chapter-1`.

## Site DOM structure

```
#faqwrap                     ← content region (primary selector)
  .ftoc                      ← table of contents (stripped as junk)
    ol > li > a[href="slug"] ← bare slug hrefs (no path prefix)
  [guide content below]
```

Content selector tried in order: `#faqwrap` → `#faqtext` → `.faqtext` → `.ffaqbody` → `#faq` → `.faq-body` → `.guide-content`.

## Text guide detection

`isTextGuide($)` checks whether a `<pre>` block inside the content area exceeds 5000 characters. Text/ASCII guides are skipped at fetch time — the fetcher throws if the TOC yields no HTML-format guides.

## Fetch strategy

Puppeteer (stealth + screen spoofing). Browser pre-warms on GameFAQs homepage to establish cookies before search.

1. Fetch the entry section page; extract TOC from `.toc_menu a[href]` (bare slug hrefs).
2. Fallback: regex scan all hrefs for `/faqs/{faqId}/{slug}` pattern if `.toc_menu` absent.
3. Fetch each section page, reusing first-page HTML for section 0.
4. Parallel image capture via browser CDP (in-browser `fetch` with session cookies → base64).
5. Write `_manifest.json` + flush `_image_cache.json` mapping original URLs → `img/{hash}.ext`.

## Image handling

Images are captured during fetch using the Puppeteer page's own session (not plain HTTP), because GameFAQs hotlink-protects images. The fetcher queries `#faqwrap img[src]`, fetches each via `page.evaluate(fetch(...))`, transfers as base64 via CDP. Saved to `_raw/img/` by URL hash. Parse step reads `_image_cache.json` to resolve `localSrc`.

`needsBrowserImageCapture = true` (implicit — the fetcher does it, not the image-downloader tool).

## Nav tree

Built from `.ftoc ol` using `extractNavTree`. Supports three node types:
- `type: 'link'` — leaf section
- `type: 'group'` — `<b>` header label followed by `<ol>` of links; the header link itself (if navigable) is promoted to group with `slug`
- `type: 'label'` — `<b>` header with no following `<ol>`

## Search strategy

Two passes, both use `nameSimilarity` + `platScore` to rank results:

1. **GameFAQs site search** — types game name into `#searchtextbox`, parses result page for `/{platform}/{gameId}-{slug}` links.
2. **DuckDuckGo fallback** — `site:gamefaqs.gamespot.com "{gameName}" faqs`.

After matching the game, fetches its `/faqs` listing page and filters for HTML-type guides (`parseFaqsPage`).

`platScore` preference order: PS5 > PS4 > Switch/PC/Xbox > older platforms.

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/guides/gamefaqs/adapter.js` | Selectors, `isTextGuide`, nav tree extraction |
| `relay-server/src/services/guides/gamefaqs/fetcher.js` | Puppeteer BFS, image capture |
| `relay-server/src/services/guides/gamefaqs/search.service.js` | Site search + DDG fallback, FAQ listing |

## Gotchas

- `.toc_menu a[href]` links are **bare slugs** (e.g. `href="introduction"`), not full paths. `rewriteInternalLinks` targets `/faqs/{faqId}/{section}` patterns in content, not the TOC.
- `_image_cache.json` must exist in `_raw/` for images to resolve during parse. If fetch was interrupted before flushing it, images will be missing.
- A guide's `faqId` is reused across platforms — same guide may be listed under ps5, pc, switch. The search picks the highest-scoring platform.
- Re-parsing without re-fetching works for content but not images — `_image_cache.json` already has the paths and parse reads from there.
