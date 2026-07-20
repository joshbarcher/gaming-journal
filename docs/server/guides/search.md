# Guide Search

Per-source search that finds guides for a game by name. Results are cached in a single per-`steamId` `_search.json` keyed by source. Search is triggered by the guides modal UI, not by the download pipeline.

Sources: `gamefaqs` (default), `ign`, `steam`, `game8`, `gamerguides`, `fandom`, `neoseeker`, `thegamer`.

## Data flow

1. Client GETs `GET /relay/api/guides/:steamId/search` → `getSearch(steamId)` returns the cached `_search.json` (or `null`).
2. To run a fresh search, client POSTs `POST /relay/api/guides/:steamId/search` with `{ gameName, source }` → `beginSearchRun`, which streams progress over SSE.
3. `beginSearchRun` validates `source`, guards against a concurrent run for the same `(steamId, source)` (`409` if busy), then dispatches to the source's `search.service.js` (launching a Puppeteer browser for scrape-based sources; steam/gamerguides need none).
4. On a hit, the result is merged into `_search.json` under `sources.{source}` behind a per-`steamId` write lock (`withWriteLock`) so parallel gamefaqs + ign searches don't clobber each other. The whole merged object is sent as the `done` payload.
5. SSE phases: `{ phase: 'status', message }`, `{ phase: 'done', data }`, `{ phase: 'not_found', message }`, `{ phase: 'error', message }`.

The download pipeline consumes these results: `buildTitleMap(steamId)` reads `_search.json`, derives each guide's id from its URL (`guideIdFromUrl`), and maps it to a cleaned title for the guide list / meta.

### Per-source behaviour
- **gamefaqs** — Puppeteer + stealth; searches the site, falls back to a DuckDuckGo `site:` query; returns multiple guides
- **ign** — wiki search, disambiguated by release year via `games.service.getOne`; one wiki "guide"
- **game8 / gamerguides / fandom / neoseeker** — slug inference or scrape; one wiki/guide entry each
- **thegamer** — DuckDuckGo search; returns *multiple* guide articles
- **steam** — direct API call (no browser); returns guides + categories

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/guides/guides.controller.js` | `getSearch`, `beginSearchRun` (dispatch + merge + write lock), `buildTitleMap` |
| `src/lib/server/relay/guides/{source}/search.service.js` | Per-source search (`searchGame`, `launchBrowser`) |
| `src/routes/relay/api/guides/[steamId]/search/+server.ts` | `GET` cached · `POST` live SSE run |

## Storage layout

One `_search.json` per `steamId` (not per source), at the steamId root:

```
{RELAY_DATA_ROOT}/guides/
  {steamId}/
    _search.json
```

Shape:
```json
{
  "steamId": "251150",
  "sources": {
    "gamefaqs": {
      "searchedAt": "…",
      "matchedGame": { "name", "gameUrl", "score", … },
      "guides": [ { "title", "url", "type" } ]
    },
    "ign": { … }
  }
}
```
Each source key is merged independently — searching ign never overwrites a prior gamefaqs result. steam entries additionally carry `categories`.

## Common questions

**Q: Why is `_search.json` written by search, not by download?**
Search results are ephemeral — they reflect what a source has at search time. The download pipeline already has the `url` (and derives `guideId`) from the result the user picked, so it never searches.

**Q: How does a Steam game name map to a guide?**
The client sends the game name as `gameName`; each source does a name-based search. No automatic matching — the user picks from the returned `guides[]` in the modal. ign additionally disambiguates by the game's release year.

**Q: Where did the old `GET …/search?q=&source=` query go?**
Gone. Reads are now `GET /relay/api/guides/:steamId/search` (returns the whole cached object); runs are a `POST` with an SSE body `{ gameName, source }`.

## Gotchas

- The cache is per `steamId`, keyed by source. Re-running a source overwrites only that source's entry; other sources persist.
- Concurrent runs for the same `(steamId, source)` are rejected `409`; different sources run in parallel and merge under `withWriteLock`.
- Scrape-based searches (gamefaqs, thegamer via DDG, game8, neoseeker) are sensitive to source HTML changes — unexpected empty results usually mean a selector rotted.
- gamefaqs launches a stealth Puppeteer browser and warms `gamefaqs.gamespot.com` before searching; the browser is closed in the run's `finally`.
