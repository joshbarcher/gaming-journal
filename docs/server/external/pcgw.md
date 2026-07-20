# PCGamingWiki (PCGW)

Scrapes PC Gaming Wiki for per-game technical data: video settings, input support,
cloud saves, DRM/availability, save paths, and known fixes. Puppeteer + stealth
plugin. Per-game files, section-level status tracking.

## Data flow

1. `syncGame(appid, { steamName })` is called by `provisionGame()` (step 5). No
   periodic scheduler — PCGW runs via provision and the on-demand `/sync` route.
2. `fetchPageTitle` resolves the wiki page title via one Cargo API call
   (`pcgamingwiki.com/w/api.php`, `Infobox_game.Steam_AppID HOLDS "<appid>"`). No
   page → `{ found: false }` written and done.
3. The full wiki page HTML is fetched through the shared Puppeteer browser and
   cached to `pcgw/html/{id}.html`. A forced sync re-fetches (a cached snapshot can
   predate whole sections); otherwise the cache is reused.
4. Six section parsers run against that HTML (`pcgw.parser.js`): `video`, `input`,
   `cloud`, `availability`, `paths`, `fixes`.
5. `collectUnknownRows(html)` records unmatched table rows; `detectDrift(html)`
   flags unexpected structure. Both saved on the entry.
6. Entry saved to `pcgw/{appid}.json` after every step (partial progress survives).
   `rebuildIndex()` regenerates `index.json` and `health.json`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/pcgw/pcgw.service.js` | `syncGame`, `syncAll`, `getEntry`, `getIndex`, `getHealth`, `clearHtmlCache`, Cargo lookup, HTML cache, **own** shared Puppeteer browser (`_getBrowser`/`launchBrowser`/`closeBrowser`) |
| `src/lib/server/relay/pcgw/pcgw.parser.js` | `parseVideoFromHtml`, `parseInputFromHtml`, `parseCloudFromHtml`, `parseAvailabilityFromHtml`, `parsePathsFromHtml`, `parseFixesFromHtml`, `collectUnknownRows`, `detectDrift` |
| `src/routes/relay/api/pcgw/**` | `GET /relay/api/pcgw`, `/[appid]`, `/health`; `POST /sync`, `/sync/[appid]`; `/html-cache`, `/html-cache/[appid]` |

> Note: PCGW manages its **own** Puppeteer instance inside `pcgw.service.js` — it
> does not use the shared `browser/browser.service.js` that Reddit/Nexus share.
> `bootRelay()` registers `closePcgwBrowser` as a shutdown closer (unconditionally,
> since an on-demand `syncGame` can launch Chrome even on a schedulers-off box).

## Storage layout

All paths relative to `RELAY_DATA_ROOT` (prod `/mnt/data-dir/gaming-journal/relay/`):

```
pcgw/
  {appid}.json    ← { appid, steamName, found, pageTitle, pageUrl,
                      video, input, cloud, availability, paths, fixes,
                      sections:{ <name>:{status,attempts,…} }, unknownRows, drift }
  index.json      ← [{ appid, steamName, pageTitle, pageUrl, drm, steamCloud, … }]
  health.json     ← { unknownRows, drift[], updatedAt }
  html/{id}.html  ← cached raw wiki page HTML
```

## Common questions

**Q: What is `collectUnknownRows`?**
A diagnostic that records table rows no known parser matched. Aggregated into
`health.json` (sorted by game count) to detect wiki structure changes.

**Q: When does `detectDrift()` run?**
After each parse. It flags unexpected structure but never aborts — partial data is
still written and the drift flag propagates to `health.json`.

## Gotchas

- Stealth: `puppeteer-extra-plugin-stealth` is registered globally to bypass bot
  detection. `_getBrowser()` health-checks (`browser.version()`) and relaunches a
  crashed browser transparently.
- Cargo returns 429 → `cargoQuery()` retries up to `MAX_RETRIES = 3` with backoff;
  a 429 on the Puppeteer page load retries with a longer backoff.
- A section failing `MAX_SECTION_FAILURES = 3` times is marked `'skipped'` and not
  retried until the next **forced** `syncGame`.
- Jitter 2–4 s between games (`PCGW_MIN_MS`/`PCGW_MAX_MS`); only network-hitting
  games sleep. `syncAll()` on a large library is slow and load-heavy — avoid running
  it frequently.
