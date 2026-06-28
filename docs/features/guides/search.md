# Guide Search & Discovery

Users search for available guides per game across 7 external sources from the journal dashboard. Results are cached locally and browsed via a per-source modal. From there guides are downloaded.

## Sources

| Source | Browser needed | Guide type |
|--------|---------------|------------|
| GameFAQs | Yes (Puppeteer) | HTML + text (text skipped) |
| IGN | Yes (Puppeteer) | HTML wiki |
| Steam | No (API) | HTML community guides |
| Game8 | Yes (Puppeteer) | HTML |
| Gamer Guides | No (slug inference) | HTML |
| Fandom | Yes (Puppeteer) | HTML wiki |
| Neoseeker | Yes (Puppeteer) | HTML walkthrough |

## Data flow

### On dashboard load
1. `onMount` → parallel: `GET /relay/api/guides/{appid}` (downloaded guides list) + `GET /relay/api/guides/{appid}/search` (cached `_search.json`)
2. Both populate the Guides card immediately from disk — no network call on load

### Running a search
1. User clicks the global **↻** button (all sources) or a per-source **↻** on an individual tile
2. UI calls `runSearch(source)` → `POST /relay/api/guides/{appid}/search` with `{ gameName, source }` (SSE)
3. Relay controller launches source-specific search (Puppeteer browser for sources that need one)
4. SSE stream sends `{ phase: 'status', message }` progress lines while running
5. On success: `{ phase: 'done', data: mergedSearchJson }` — `data` is the full updated `_search.json`
6. UI merges the new source entry into `searchData` state (`mergeSource`) without re-fetching
7. On `not_found`: `searchNotFound = true`, tile shows empty state

### Viewing results & downloading
1. User clicks an active source tile → `openGuideModal(src)` → renders `GuidesModal` with that source's data
2. GuidesModal lists all guides for the source with download state overlaid from the job store
3. Clicking **Download** → see [downloading.md](downloading.md)

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/JournalDashboard.svelte` | Guides card UI, `runSearch`, `refreshSearch`, modal trigger |
| `src/lib/svelte/journal/guide/GuidesModal.svelte` | Per-source guide list, download buttons, refresh button |
| `relay-server/src/controllers/guides/guides.controller.js` | `handleSearch` (GET), `handleSearchRun` (POST SSE) |
| `relay-server/src/services/guides/ign/search.service.js` | IGN search (Puppeteer) |
| `relay-server/src/services/guides/gamefaqs/search.service.js` | GameFAQs search (Puppeteer) |
| `relay-server/src/services/guides/steam/search.service.js` | Steam search (Published File API) |
| `relay-server/src/services/guides/game8/search.service.js` | Game8 search (Puppeteer) |
| `relay-server/src/services/guides/gamerguides/search.service.js` | Gamer Guides (slug inference) |
| `relay-server/src/services/guides/fandom/search.service.js` | Fandom search (Puppeteer) |
| `relay-server/src/services/guides/neoseeker/search.service.js` | Neoseeker search (Puppeteer) |

## Storage: `_search.json`

Written by the relay on each search run. Persists across restarts — the UI loads this cold on mount.

```json
{
  "steamId": "2161700",
  "sources": {
    "ign": {
      "searchedAt": "2026-06-01T12:00:00Z",
      "matchedGame": { "name": "Persona 3 Reload", "gameUrl": "https://ign.com/wikis/persona-3-reload", "score": 1.0 },
      "guides": [{ "title": "Persona 3 Reload Wiki", "url": "https://www.ign.com/wikis/persona-3-reload", "type": "html" }]
    },
    "steam": {
      "searchedAt": "...",
      "matchedGame": { ... },
      "guides": [...],
      "categories": { "Walkthroughs": [...], "Tips & Tricks": [...] }
    }
  }
}
```

- `matchedGame.score` — fuzzy match confidence (1.0 = exact)
- `categories` — Steam only; GuidesModal renders category tabs when present
- `type` — `"html"` | `"text"` | `"unknown"`; text guides (GameFAQs ASCII) are shown but skipped during download

## UI: Guides card on the dashboard

7 source tiles + 1 "Downloaded" tile (links to `/journal/{appid}/guides`). Each source tile:
- **Empty state** (no `searchData` for that source): shows `—`, click does nothing
- **Active state** (search result exists): shows guide count + downloaded count, click opens GuidesModal
- **Spinning state** (`searchingSet.has(src)`): search in progress for that source

The global ↻ button runs all 7 sources in parallel (`Promise.all`). Per-source ↻ runs just that one.

## Common questions

**Q: Search results disappeared after a relay restart. Why?**
They didn't — `_search.json` is on disk and reloaded on the next dashboard mount. The in-memory `searchData` state is lost on page refresh, but the dashboard refetches `GET /relay/api/guides/{appid}/search` on every mount.

**Q: A source shows no results even though the game definitely has a guide there.**
The fuzzy match failed. The search uses the Steam game name (e.g. "Persona 3 Reload") to search each source. If the source spells it differently, the score may be too low. Run a per-source search again after the relay logs to check the match score and what was found.

**Q: Steam shows category tabs in the modal but other sources don't. Why?**
Steam search returns `categories` (e.g. Walkthroughs, Reference, etc.) because the Steam API groups guides by tag. Other sources return a flat `guides[]` array. GuidesModal renders tabs only when `sourceData.categories` is present.

**Q: The search POST returns 409. What does that mean?**
A search for that source is already running (duplicate concurrent request). The UI handles this by polling `GET /relay/api/guides/{appid}/search` after 6 seconds and merging the result when it arrives.

**Q: How does Gamer Guides search work without a browser?**
It infers the guide slug from the game name (kebab-case) and pings `https://www.gamerguides.com/{slug}/guide`. If the page exists it's a match. No Puppeteer needed.

## Gotchas

- **All 7 source searches run in parallel** on the global ↻ — each opens its own browser instance if needed. This can be memory-heavy on the relay host.
- **Search results are per-source, not merged** — each tile shows one source's results. There's no unified "all sources" result list.
- **IGN search returns one guide per wiki** (the wiki root URL). IGN wikis are a single multi-page guide, not a list of guides.
- **`_search.json` is append-merged**, not overwritten — running a new search for one source only updates that source's entry, leaving other sources' cached results intact.
- **`score` is not displayed in the UI** — it's used internally to decide if a match is good enough. A score below threshold results in `not_found`.
