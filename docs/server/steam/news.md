# Steam News

Fetches and caches game news from the Steam news API. On-demand — fetched when the game detail page requests news. Filters to English-language, non-noisy posts, and converts BBCode to HTML. Lives in `src/lib/server/relay/news/news.service.js`.

## Data flow

1. `fetchAndCache(appid)` calls `ISteamNews/GetNewsForApp/v0002/?appid={appid}&count=15&maxlength=0&format=json`.
2. HTTP 429 is re-thrown as an error carrying `rateLimited: true`.
3. Empty-response guard: if `newsitems` is empty but a prior cache has items, the prior cache is returned (avoids wiping the article list on a transient empty response).
4. Filters: `isRelevant()` (blocks `BLOCKED_FEEDS` — currently `SteamDB`); `isEnglish()` (blocks titles with non-Latin script — Cyrillic, CJK, Hiragana/Katakana, Korean, Arabic, Thai).
5. `processItem()` converts BBCode → HTML via `bbcodeToHtml()`, then derives a card preview (`previewImage` = first `<img>`, `excerpt` = first 240 chars of text).
6. Cached to `steam/news/{appid}.json`.
7. `getNews(appid)` reads the cache (direct `fs.readFile`) and self-heals entries missing `previewImage`/`excerpt`.
8. `getArticle(appid, gid)` returns one item with its body parsed into `ContentBlock[]` via `newsBlocks()` (the shared guide `parseContent` pipeline); it drops the hero image from the body if it duplicates `previewImage`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/news/news.service.js` | `fetchAndCache`, `getNews`, `getArticle`, `newsBlocks`, filtering + preview logic |
| `src/lib/server/relay/shared/bbcode.js` | `bbcodeToHtml` — Steam BBCode → HTML |
| `src/lib/server/relay/guides/parser/content-parser.js` | `parseContent` — HTML → `ContentBlock[]` (used by `newsBlocks`) |
| `src/routes/relay/api/news/[appid]/+server.ts` | `GET /relay/api/news/[appid]` (`relayRoute('news')`) |
| `src/routes/relay/api/news/[appid]/[gid]/+server.ts` | `GET /relay/api/news/[appid]/[gid]` — single article with parsed blocks |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  news/
    {appid}.json   ← { fetchedAt, appid, items[{ gid, title, url, is_external_url, author, contents, previewImage, excerpt, feedlabel, feedname, date }] }
```

`contents` is the full article body converted from BBCode to HTML.

## Gotchas

- `maxlength=0` returns full article content (no truncation) — some articles are very long.
- No TTL — news is cached on first request and not auto-refreshed.
- 429 surfaces as `rateLimited: true` for the route to translate to a 429.
- `isEnglish` is heuristic — an English post containing some non-Latin characters may be filtered. `SteamDB` is blocked as automated, non-human news.
