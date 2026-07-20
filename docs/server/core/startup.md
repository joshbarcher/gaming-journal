# Server Startup (boot sequence)

The relay's data services boot from `src/lib/server/relay/boot.js`, not a standalone process. Since the 2026-07-17 fold-in there is no separate Express `server.js` and no `:8050` — the services run inside the gaming-journal SvelteKit app (`:8061`). `src/hooks.server.ts` calls `bootRelay()` once at startup and `closeRelay()` on graceful shutdown.

## Data flow

### hooks.server.ts → bootRelay()
1. SvelteKit loads route modules lazily, so schedulers must be started from `boot.js` — never as an import side effect of a service, never from a route module.
2. `bootRelay()` is idempotent (`_booted` guard) and splits into two halves: **fast-boot cache loads** (always run) and **schedulers** (gated).

### Fast-boot cache loads (always, schedulers or not)
Fire-and-forget, `.catch()`-guarded. Each loads a persisted sidecar in one read and refreshes in the background (see `createPersistedIndex` in `shared/persisted-index.js`) — replacing the old scan-thousands-of-files-per-boot that saturated startup:
- `bootCommunityReviews()`, `buildUpcomingCache()`, `loadAchievementsCache()`

Browser closers (`pcgw`, `reddit`, `scraper`) are registered unconditionally — no-ops if Chrome never launches.

### Scheduler gate — `ENABLE_SCHEDULERS`
If `schedulersEnabled()` (`shared/scheduler.js`) is false, boot logs "serving reads only" and **returns here** — a dev instance serves reads from sidecars without holding ManagedFile handles on NAS files the prod writer owns. Only the prod instance (`ENABLE_SCHEDULERS=true` in `.env.local`) runs the schedulers below.

### Schedulers (prod only), by migration wave
Started via `startScheduler(name, fn)`; stopped via `registerCloser(name, fn)` / `closeRelay()`:
1. **Metrics first** — `loadMetrics()` (the tick recorder), then `disk-usage`.
2. **Wave 1** — `itad` (72h sync), `protondb` (weekly), `hltb` (retry).
3. **Wave 2** — `reddit` (shared Puppeteer browser → sync scheduler), `pin` (restore + 20-min refresh), `nexus`.
4. **Wave 3** — `featured` (hourly), `applist` (build → adult-content backfill), derived caches `games-cache` / `wishlist-cache` / `player-counts-cache` (fast-boot sidecar + background refresh), `provision` (backfill → wishlist recheck).
5. **Wave 4** — `now-playing`: `loadPlayLog()` **must** resolve before `startNowPlayingPoller()` + `buildAccountCache()` (both read session data); then `sessions` (the 30-min tick, see `core/sync-tick.md`).

## Key files

| File | Role |
|------|------|
| `src/hooks.server.ts` | Calls `bootRelay()` / `closeRelay()` |
| `src/lib/server/relay/boot.js` | The boot sequence — fast-boot loads + `startScheduler()` calls |
| `src/lib/server/relay/shared/scheduler.js` | `schedulersEnabled`, `startScheduler`, `registerCloser`, `closeAll` |
| `src/lib/server/relay/shared/persisted-index.js` | `createPersistedIndex` — sidecar fast-boot + background refresh |
| `src/lib/server/relay/steam/play-log.service.js` | `load` — must finish before the now-playing poller |

## Common questions

**Q: Why must `loadPlayLog()` finish before the now-playing poller starts?**
The poller calls `openSession()` / `closeSession()`, which write the play log. If the singleton isn't loaded, those writes trigger a concurrent `load()` — a double-load race. Loading eagerly in the `now-playing` scheduler thunk avoids it.

**Q: Why are schedulers gated but cache loads unconditional?**
Reads (route handlers) must work everywhere; a dev instance loads sidecars read-only. Schedulers WRITE the NAS (poster upkeep, provision, pin-driven reddit re-syncs), so only the prod writer (`ENABLE_SCHEDULERS=true`) runs them — dev never writes NAS data the prod process owns.

**Q: How is a scheduler turned off individually?**
`startScheduler(name, fn)` checks `SCHED_<NAME>=off`; per-feature flags in `.env.local` disable a single scheduler without disabling all.

## Gotchas

- No `RELAY_URL`, no `:8050`, no catch-all proxy — all removed at decommission. SSR loaders reach these services via `journalRelayBase()` (self, `127.0.0.1:$PORT/relay`); the public path is `/relay/api/*`.
- Fast-boot loads are fire-and-forget: `boot()` awaits only the fast sidecar read; the index route's `ensureIndex()`/`ensureBuilt()` covers the race if a request lands mid-refresh.
- Graceful shutdown (`closeRelay()` → `closeAll()`) flushes metrics + closes browsers + stops pollers. ManagedFile singletons flush on write (`flush()`), not on shutdown — never rely on a shutdown drain for durability.
