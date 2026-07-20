# NexusMods mods

## Overview

Surfaces a game's top mods from [NexusMods](https://www.nexusmods.com) for the game
page's "Mods" section, plus a full mods page, single-mod detail, and a deep
full-catalogue crawl. Data comes from Nexus's **official API** (no scraping) —
`api.nexusmods.com` is outside the Cloudflare wall that fronts the website:

- **v2 GraphQL** (`api.nexusmods.com/v2/graphql`) — the workhorse; one query returns
  a game's mods with every card field.
- **v1 REST** (`api.nexusmods.com/v1/games.json`) — the ~4,900-game catalogue, used
  only to resolve a Steam title to a Nexus `domain_name`.

Auth is the operator's personal `NEXUS_API_KEY` in the `apikey` header (personal-use,
single-user LAN app). Author-image galleries are the one thing with no API — scraped
via the shared stealth browser, optionally behind a captured login session.

## Data flow

```
1. Game page → GET /relay/api/nexus/:appid?fetch=true&name=<steamName>
2. Route handler: cache miss → 202 {status:'pending'} + syncOne(appid,name) in background
3. syncOne → resolveGame(appid, name):
      a. overrides.json  ({ "<appid>": "<domain>" })         ← authoritative
      b. exact normalized name/domain match vs games list
      c. longest Nexus-name-contained-in-Steam-title match    ← "…: Skyrim Special Edition"
4. matched  → fetchMods(domain) via GraphQL → shapeMod() → write nexus/<appid>.json
              + rebuild index; then cacheModImages() mirrors thumbs/images and re-persists
   unmatched → sentinel { domainName:null, mods:[] } so we don't re-resolve every view
5. Client re-fetches /relay/api/nexus/:appid → 200 with the entry
6. Weekly scheduler (refreshStale) re-fetches only ALREADY-cached games past TTL.
```

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/nexus/nexus.service.js` | `resolveGame`/`matchGame`, `fetchMods`, `getModsPage`, `getModDetail`, `startDeepPull`, `shapeMod`, `syncOne`, `refreshStale`, in-memory caches, `startNexusSyncScheduler` |
| `src/lib/server/relay/nexus/images-scraper.js` | `scrapeAuthorImages` — stealth-browser scrape of `?tab=images` (the API-less gallery) |
| `src/lib/server/relay/nexus/session.service.js` | Nexus website login session (cookies) for adult-mod scraping |
| `src/lib/server/relay/nexus/backfill.service.js` | Resumable adult-mod author-image backfill job |
| `src/lib/server/relay/nexus/bbcode.js` | BBCode → HTML for mod descriptions |
| `src/routes/relay/api/nexus/**` | route handlers (no controller file — logic lives in each `+server.ts`, wrapped by `relayRoute('nexus', …)`) |

## Storage layout

All paths relative to `RELAY_DATA_ROOT` (prod `/mnt/data-dir/gaming-journal/relay/`):

```
nexus/
  games.json        ← { fetchedAt, games:[{id,name,domain_name}] }  (weekly TTL)
  overrides.json    ← { "<appid>": "<domain_name>" }  manual Steam→Nexus map
  index.json        ← [{ appid, steamName, domainName, nexusName, totalMods, modCount, fetchedAt }]
  session.json      ← captured Nexus login cookies { cookies[], capturedAt, status }
  backfill.json     ← adult-image backfill queue + cursor
  <appid>.json      ← one game's section entry (top NEXUS_MOD_COUNT mods)
  images/<appid>/   ← mirrored mod images (<modId>.<ext>, <modId>_thumb.<ext>, g_<hash>.<ext>)
  mods/<appid>/     ← per-mod rich detail cache (<modId>.json)
  deep/<appid>.json ← full-catalogue crawl dataset + progress
```

Unmatched games get the same section shape with `domainName: null`, `mods: []`.
Images served at `/relay/images/nexus/*` (WebP sidecar via `serveWithWebp`); the
frontend renders `/relay{localThumb}` and falls back to the CDN `thumbUrl`/`imageUrl`.

## Endpoints (all under `/relay/api/nexus`)

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/` | Index of cached games. |
| GET  | `/:appid` | Cached section entry. `?fetch=true&name=<steamName>` → 202 + background fetch on miss. |
| GET  | `/:appid/mods` | Full page — live paginated/sorted/searched mods. `?sort` `?offset` `?limit`(≤50) `?q` `?adult=hide\|only\|all` `?name`. |
| GET  | `/:appid/mod/:modId` | Single-mod rich detail (description blocks + mirrored gallery). |
| POST | `/:appid/deep` / GET `/:appid/deep` | Start / poll a full-catalogue crawl (`deep/<appid>.json`, cap `NEXUS_DEEP_CAP`). |
| POST | `/sync/:appid` | Force one game. `?force` `?name` `?domain=<override>` (persists to overrides.json). Generic 500 on error (no key/GraphQL leak). |
| POST | `/refresh` | Refresh all stale cached games. 409 if already running. |
| GET/POST/DELETE | `/session` | Adult-mod login session: status / store captured cookies / clear (never echoes cookie values). |
| GET/POST | `/backfill` | Adult-image backfill progress / `action=start\|pause\|reset`. |

## Config

| Env | Default | Notes |
|-----|---------|-------|
| `NEXUS_API_KEY` | — | Required. Personal key. `.env` is git-tracked — treat as a committed secret. |
| `NEXUS_MOD_COUNT` | 12 | Mods stored per game (section). |
| `NEXUS_SYNC_INTERVAL_HOURS` | 168 | Per-game TTL + scheduler cadence. |
| `NEXUS_DEEP_CAP` | 5000 | Max mods per deep crawl. |
| `NEXUS_BACKFILL_PER_GAME_CAP` | 500 | Adult mods enumerated per game in the backfill. |
| `NEXUS_SCRAPE_AUTHOR_IMAGES` | — | `false` disables the author-images scrape (tests). |

## In-memory caching

The relay is the **sole writer** of `nexus/` JSON, so reads are served from process
memory with write-through to disk (`MEM_TTL_MS` 10 min): the games list (`_gamesMem`),
section entries (`_entryMem`), mod detail (`_detailMem`), and deep datasets
(`_deepMem`). `_resetCaches()` clears them (tests). Index rebuild scans disk only on
the write path.

## Adult mods (still applies after fold-in)

Adult mod pages are gated behind a logged-in Nexus account with adult content enabled
— the API key authenticates the API, not the website. Capture cookies by re-running
`scripts/capture-nexus-session.mjs` (writes via `POST /relay/api/nexus/session`);
`applySession` injects them before a scrape, and `markSessionExpired` flags the
session when a scrape hits the login/adult wall *despite* cookies — the backfill then
pauses and the UI prompts a re-login. Adult author-images come only from the
authenticated `backfill.service` job, never the ad-hoc on-demand scrape.

## Common questions

**Why is a game showing no mods?** It isn't on Nexus, or name-matching failed (a
sentinel was written). Add an `overrides.json` entry or
`POST /relay/api/nexus/sync/:appid?domain=<domain>&force=true`.

**Where does the mod URL come from?** Constructed:
`https://www.nexusmods.com/{domainName}/mods/{modId}`.

## Gotchas

- **Transient vs. confirmed:** a GraphQL response with `data.mods == null` (no
  errors) throws rather than returning empty — callers must not persist a `{mods:[]}`
  sentinel over good data. Same for an empty games list (`getGamesList` keeps the
  prior cached list). A no-match resolution reuses the existing `domainName`.
- Author-image scrape is serialized, ≥6 s apart, on-demand, guarded once per mod
  (`authorImagesAt`), retried no more than once per 30 s (`authorImagesTriedAt`).
- The scraper reuses the shared `browser/browser.service.js` (same Chrome as
  Reddit/PCGW-adjacent), started in `bootRelay()`.
- Nexus embeds a timestamp in image URLs, so a changed URL triggers a re-download and
  drops the stale `.webp` sidecar. Mod detail `description` is BBCode + embedded HTML,
  parsed to ContentBlocks via `descriptionToBlocks` (reuses the guide parser).
