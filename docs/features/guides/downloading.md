# Guide Downloading

Users can download walkthrough guides from external sources (IGN, GameFAQs, Steam, Game8, Gamer Guides, Fandom, Neoseeker) into the local app for offline reading.

## Data flow

1. User opens the Guides modal for a game → clicks **Download** on a guide entry
2. UI calls `jobStore.enqueue()` → `POST /api/guides/jobs` → job added to in-memory queue
3. Job runner (job-queue.js) dequeues and spawns two child processes in sequence:
   - `fetch-guide.js --url … --steam-id … --source … --guide-id …`
   - `parse-guide.js --steam-id … --source … --guide-id …`
4. Both scripts stream `[PROGRESS] {...}` lines to stdout; controller forwards them as SSE to the UI
5. UI subscribes to `GET /api/guides/jobs/stream` (SSE) → job store updates → progress shown in Downloads page
6. On completion, job transitions to `done`; GuidesModal `$effect` fires `onDownloaded()` → guide list refreshes

### fetch-guide.js (per source)
- IGN: launches Puppeteer, loads index page, BFS-crawls all pages via sidebar + article body links, saves each as `_raw/{slug}.html`, writes `_manifest.json`
- GameFAQs: similar Puppeteer BFS from `.ftoc` nav
- Steam: single Puppeteer fetch, cheerio slices into per-section files
- Game8 / Gamer Guides / Fandom / Neoseeker: similar patterns, source-specific selectors

### parse-guide.js
Reads every `_raw/*.html` file listed in `_manifest.json`, runs it through the source adapter (html-cleaner → content-parser → image-downloader), writes:
- `{guideId}/{slug}/content.json` — ContentBlock[] for each page
- `{guideId}/_meta.json` — title, navTree, page list, parsedAt, sizeBytes
- `{guideId}/{slug}/img/*.webp` — downloaded + converted images (unless `--no-images`)

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/guides/job-queue.js` | In-memory job queue, SSE broadcast, child process runner |
| `relay-server/src/controllers/guides/guides.controller.js` | `handleJobEnqueue`, `handleJobList`, `handleJobStream`, `handleDownload` |
| `relay-server/src/tools/fetch-guide.js` | CLI entry point — dispatches to source fetcher |
| `relay-server/src/tools/parse-guide.js` | CLI entry point — dispatches to source adapter + parser |
| `relay-server/src/services/guides/ign/fetcher.js` | IGN BFS fetcher |
| `relay-server/src/services/guides/ign/adapter.js` | IGN selectors, nav extraction, link rewriting |
| `relay-server/src/services/guides/parser/content-parser.js` | DOM → ContentBlock[] |
| `relay-server/src/services/guides/parser/html-cleaner.js` | Strips junk, unwraps elements, rewrites links |
| `src/lib/svelte/journal/guide/GuidesModal.svelte` | Download UI, refresh button, job state display |
| `src/lib/svelte/downloads/DownloadsPage.svelte` | Live job progress view |
| `src/lib/guide-jobs.svelte.ts` | Client-side job store, SSE subscription |

## Storage layout

```
$DATA_DIR/relay/guides/{steamId}/
  _search.json                    ← search results for all sources (written by search, not download)
  {source}/                       ← e.g. ign/, gamefaqs/
    {guideId}/
      _raw/
        _manifest.json            ← page list, fetchedAt, wikiSlug (IGN), sourceUrl
        _index.html               ← IGN only: index page for title/nav extraction
        {slug}.html               ← one raw HTML file per page
      _meta.json                  ← title, author, navTree, pages[], parsedAt, sizeBytes
      _fulltext.json              ← Fuse.js search index (built on first request if missing)
      {slug}/
        content.json              ← ContentBlock[] — the app-facing parsed content
        preview.html              ← standalone HTML preview
        img/
          001.webp, 002.webp …   ← downloaded + converted images
```

## Common questions

**Q: Does the relay server need to restart for fetch-guide.js changes to take effect?**
No. fetch-guide.js and parse-guide.js are spawned as fresh child processes each run. They import the updated source files (adapters, fetcher) directly from disk. Only changes to the controller or job-queue itself require a relay restart.

**Q: Does downloading skip pages already on disk?**
Yes. fetch-guide.js defaults to `force=false`. If `_raw/{slug}.html` already exists, it reads from disk instead of fetching from the network. Pass `--force` to re-fetch everything.

**Q: Why does parse-guide need `--no-images` when re-parsing?**
`--no-images` skips downloading new images from the network. Images already converted to WebP in `img/` are always included via their `localSrc` — `--no-images` only skips fetching URLs not yet on disk. Safe to use for re-parses after a code fix.

**Q: Where does the guide title come from?**
The `_search.json` file (written by the search step) is the source of truth for guide titles as shown in the UI. `_meta.json` has the parsed page title. The controller merges them: search title wins.

**Q: What happens if a job fails mid-fetch?**
The job transitions to `error` state with the error message. Pages already fetched remain on disk. Clicking Retry re-runs from the beginning (same as a new download), but existing cached pages are skipped.

## Gotchas

- **IGN BFS only follows sidebar links on non-index pages** (historical behavior, partially fixed June 2026 to also scan article bodies). Hub pages like `social-links-guide` that list children only in the article body would previously result in empty child pages.
- **Job queue is in-memory** — relay server restart clears all pending/running jobs. In-progress downloads are lost and must be retried.
- **`_fulltext.json` is not written at parse time** — it's built on the first `GET /api/guides/:steamId/:source/:guideId/fulltext` request and then cached. Re-parsing does not invalidate it; delete the file manually to regenerate.
- **Image downloads are the slow part** of parsing — a guide with 50+ pages and many images can take several minutes. `--no-images` makes re-parses nearly instant.
- **GameFAQs text guides are skipped** — `isTextGuide($)` detects ASCII-art FAQ format and the fetcher skips them. Only HTML guides are downloaded.
