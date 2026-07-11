# Relay Server — orientation (read this first)

**The relay is a separate repo at `C:\dev\relay-server` (not in this workspace).** This
app (`gaming-journal`, a SvelteKit frontend + a React Native app) is tightly coupled to it:
almost every piece of third-party or cached data — Steam, HLTB, ITAD prices, ProtonDB,
PCGamingWiki, Reddit, guides, now-playing — is fetched, cached, and served by the relay,
and this app reads it through a `/relay/*` proxy. If a task mentions fetching external data,
caching to disk, schedulers, or a new per-game data section, **the server half lives in
`C:\dev\relay-server`** and you will need to edit both repos.

Relay's own conventions live in `C:\dev\relay-server\CLAUDE.md`. Per-area deep dives live in
`C:\dev\relay-server\docs\features\` (format spec: `docs\features\guidance.md`).

---

## Topology

```
┌─────────────────────────────┐        /relay/*  (HTTP proxy)        ┌──────────────────────────────┐
│ gaming-journal (this repo)  │  ─────────────────────────────────▶ │ relay-server  C:\dev\relay-server │
│ SvelteKit @ (dev :5173)     │   strips /relay → forwards to        │ Express @ :8050 (PORT in .env)   │
│ react-native/  (Expo app)   │   RELAY_URL (default localhost:8050) │ node --env-file .env src/boot.js │
└─────────────────────────────┘ ◀───────────────────────────────── └──────────────┬───────────────┘
        │ validates responses against contracts/*.ts (zod)                          │ reads/writes JSON only
        ▼                                                                            ▼
  src/lib/svelte/game/sections/*.svelte                              $DATA_DIR\relay\<feature>\*.json
                                                                     ($DATA_DIR = \\192.168.86.74\app-data)
```

- **Proxy:** [src/routes/relay/[...path]/+server.ts](src/routes/relay/[...path]/+server.ts)
  forwards `GET/POST/PUT/PATCH/DELETE /relay/<x>` → `${RELAY_URL}/<x>`. So the relay route
  `GET /api/itad/:appid` is reached from the browser as `GET /relay/api/itad/:appid`.
- **Relay base URL:** `process.env.RELAY_URL` on the frontend (falls back to
  `http://localhost:8050`). In prod the relay runs on the LAN box `192.168.86.65`.
- **Data store:** the relay persists everything as JSON under `$DATA_DIR\relay\` — no database.
  `$DATA_DIR` is the UNC share `\\192.168.86.74\app-data`. This app also reads a few relay
  files directly off that share (see [src/hooks.server.ts](src/hooks.server.ts)).

---

## Relay architecture (services / controllers / routers)

Every feature is a triad under `C:\dev\relay-server\src\`:

| Layer | Path | Role |
|-------|------|------|
| Router | `src/routers/<feature>/<feature>.router.js` | Express routes. **Static routes before parameterised ones** (`/stores` before `/:appid`). |
| Controller | `src/controllers/<feature>/<feature>.controller.js` | Thin. try/catch → `logger` → status codes. `202 {status:'pending'}` for on-demand fetch, `409` if a sync is already running. |
| Service | `src/services/<feature>/<feature>.service.js` | All logic: external API calls, disk I/O, sync, scheduler, shape helpers (exported for tests). |

- **Mounting:** routers are imported and `app.use('/api/<feature>', <feature>Router)` in
  `src/server.js`. Schedulers (`startXScheduler()`) are called inside the `app.listen(...)`
  callback there too.
- **Storage helpers** (per-feature, mirror ITAD): `featureDir()` = `path.join(DATA_DIR,'relay','<feature>')`,
  `entryPath(appid)`, `indexPath()`. Entries are `{appid}.json`; a rebuilt `index.json`
  holds a lightweight summary for list views.
- **Robust I/O:** use `managed-file.js` (backed-up, recoverable JSON) for singletons;
  simple per-entry files use plain `fs`. `cache-manager.js`'s `rebuild('games','wishlist')`
  refreshes derived caches after a sync.
- **Metrics:** wrap scheduled syncs in `tracked('<feature>', fn)` (from
  `services/metrics/tracked.js`) so runs show on the dashboard.
- **Concurrency / politeness:** `utility/map-chunked.js` for bounded parallelism; `jitter()`
  + `sleep()` between external calls.
- **Game list:** `utility/getAllGames.js` returns the owned+wishlist Steam games to iterate.
- **Scraping:** `puppeteer-extra` + stealth is already a dependency; the shared browser lives
  in `services/browser/` and `services/pcgw`, `services/reddit` use it. Prefer official APIs
  over scraping when one exists.

### The ITAD slice is the canonical template

`ITAD` (IsThereAnyDeal prices) is the closest analog for any **per-game third-party API**
section. Read these three before adding a similar feature:
- `src/services/itad/itad.service.js` — id-resolution + null sentinel for not-found,
  TTL freshness (`fetchedAt` vs `ITAD_SYNC_INTERVAL_HOURS`), batch fetch, `rebuildIndex()`,
  `startItadSyncScheduler()`, on-demand `syncOne()`.
- `src/controllers/itad/itad.controller.js` — the 202-pending / 409-busy pattern.
- `src/routers/itad/itad.router.js` — static-before-param ordering.

---

## Request lifecycle (end-to-end, using a per-game section)

```
1. GamePage.svelte Phase-2 loader fetches /relay/api/<feature>/<appid>
2. +server.ts proxy → RELAY_URL/api/<feature>/<appid>
3. relay router → controller.handleGetEntry → service.getEntry(appid)
4. service reads $DATA_DIR\relay\<feature>\<appid>.json (or 202 + kicks off syncOne on miss)
5. frontend relay-api wrapper parses the JSON against contracts/<feature>.ts (zod) — a schema
   mismatch throws immediately instead of surfacing as undefined deep in a component
6. <Feature>.svelte renders; registered in GamePage.svelte + NavRail as a #game-sec-<feature>
```

Frontend load is two-phase: the page shell renders first, then background section loaders
stream data in (see `onMount` Phase 2 in
[src/lib/svelte/game/GamePage.svelte](src/lib/svelte/game/GamePage.svelte)). New sections
join `phase2Sections` + the `NavRail` list.

---

## Recipe: add a per-game section backed by a new third-party API

**Relay side (`C:\dev\relay-server`)** — copy the ITAD triad:
1. `src/services/<feature>/<feature>.service.js` — API calls + `getEntry`/`syncOne`/
   `rebuildIndex` + `start<Feature>Scheduler`. Cache to `$DATA_DIR\relay\<feature>\`.
   Resolve the Steam→provider id once and cache a `null` sentinel for not-found so backfill
   doesn't re-provision every boot.
2. `src/controllers/<feature>/<feature>.controller.js` — thin handlers.
3. `src/routers/<feature>/<feature>.router.js` — routes, static before param.
4. Wire into `src/server.js`: import router → `app.use('/api/<feature>', <feature>Router)`;
   import + call `start<Feature>Scheduler()` in the `listen` callback.
5. Add any secret to `.env` (and `.env.test`); read via `process.env` with a clear throw if missing.
6. Tests under `src/tests/<feature>/` with `node --test` — must not touch live data and must
   clean up.

**Frontend side (this repo):**
7. `contracts/<feature>.ts` — zod schema + inferred type (model on `contracts/itad.ts`).
8. Optionally extend [src/lib/js/relay-api.ts](src/lib/js/relay-api.ts) with a validated wrapper
   (`fetch('/relay/api/<feature>/…')` → `Schema.parse`).
9. `src/lib/svelte/game/sections/<Feature>.svelte` — model on
   [src/lib/svelte/game/sections/ProtonDB.svelte](src/lib/svelte/game/sections/ProtonDB.svelte)
   (`#game-sec-<feature>` id, refresh button, external-link icon).
10. Register in [src/lib/svelte/game/GamePage.svelte](src/lib/svelte/game/GamePage.svelte):
    import, add to `phase2Sections`/NavRail, add the Phase-2 fetch.
11. Mirror in `react-native/` if the section should appear on mobile (see `react-native/src/api/`).

---

## Conventions & gotchas

- **Relay coding rules** (`C:\dev\relay-server\CLAUDE.md`): ESM + async/await, Express only,
  plain HTML/CSS/JS (no frameworks, no embedded `<style>`/`<script>`), JSON files only (no DB),
  `--env-file` (not dotenv), `PORT` required in `.env`, KISS, delta UI updates only, no
  prompt/confirm/alert.
- **No worktrees** (both repos) — edit the working dir directly. [[feedback_no_worktrees]]
- **No commits unless asked.** [[feedback_no_commits]]
- **Restart disrupts live sessions:** restarting the relay mid-play can drop the now-playing
  session (post-restart poll flap). Check `/relay/api/steam/...` now-playing first and batch
  deploys. [[feedback_relay_restart_disrupts_session]]
- **Playtime source of truth:** Steam playtime is stale during active sessions — use the relay
  poller fields. See `docs/play-times.md`.
- Frontend contract validation is deliberate: a relay schema drift throws at the boundary, not
  as a silent `undefined` in a component.

---

## Config, run, test, deploy

**Relay `.env` keys** (values live only on the box): `PORT` (8050), `DATA_DIR`
(`\\192.168.86.74\app-data`), `STEAM_API_KEY`, `STEAM_ID`, `STEAM_VANITY_URL`, `MAIL_*`,
`ITAD_API_KEY`, `ITAD_COUNTRY`, `ITAD_SYNC_INTERVAL_HOURS`, `IGDB_CLIENT_ID/SECRET`,
`REDDIT_USER_AGENT`. Add new provider keys here.

**Frontend env:** `RELAY_URL` (points at the relay; default `http://localhost:8050`).

- **Run relay:** `npm run dev` / `npm start` → `node --env-file .env src/boot.js`. `boot.js`
  self-heals: it kills whatever holds `PORT` (via PowerShell `Get-NetTCPConnection`) then spawns
  `src/server.js`. Graceful `SIGINT/SIGTERM` closes Puppeteer + flushes metrics.
- **Test relay:** `npm test` (`node --test --env-file .env.test`). Tests must be isolated and
  self-cleaning.
- **Deploy:** the relay runs on the LAN host `192.168.86.65`; a code change requires restarting
  that process there. Many memories note "needs relay redeploy/restart" — confirm the exact
  restart step with the operator; treat it as a manual, batched action, not automatic.

---

## Key files

| Repo | File | Role |
|------|------|------|
| relay | `src/server.js` | Router mounts + scheduler starts (the wiring map) |
| relay | `src/boot.js` | Port-freeing dev launcher |
| relay | `src/services/itad/itad.service.js` | Canonical per-game third-party template |
| relay | `src/services/browser/` | Shared Puppeteer+stealth browser |
| relay | `CLAUDE.md`, `docs/features/` | Conventions + per-area deep dives |
| journal | [src/routes/relay/[...path]/+server.ts](src/routes/relay/[...path]/+server.ts) | `/relay/*` → relay proxy |
| journal | [src/lib/js/relay-api.ts](src/lib/js/relay-api.ts) | Validated relay call wrapper |
| journal | [contracts/](contracts/) | zod schemas for every relay response |
| journal | [src/lib/svelte/game/GamePage.svelte](src/lib/svelte/game/GamePage.svelte) | Section registry + Phase-2 loaders |
| journal | [src/lib/svelte/game/sections/](src/lib/svelte/game/sections/) | Per-game section components |
