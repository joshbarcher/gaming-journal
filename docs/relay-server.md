# Backend Server Architecture — orientation (read this first)

The "relay" is no longer a separate service. As of the 2026-07-17 fold-in, all backend data services (Steam, HLTB, ITAD, ProtonDB, PCGamingWiki, Reddit, Nexus, IGDB, guides, now-playing, recommend, provision…) run **in-process inside this app**, and the standalone relay process was decommissioned (`:8050` dead, old `C:\dev\relay-server` repo dormant). If a task mentions fetching external data, caching to disk, schedulers, or a new per-game section, **it's a single-repo change here** — not a separate repo.

History, cutover record, and the data-integrity audit: **[relay-fold-in.md](relay-fold-in.md)**.

---

## Topology (post fold-in)

```
┌────────────────────────────────────────────────────────────┐
│ gaming-journal  (SvelteKit adapter-node @ :8061)           │
│                                                            │
│  browser / RN ── /relay/api/* ──▶ src/routes/relay/api/**  │  concrete route handlers
│  SSR loaders ─── journalRelayBase() (self, 127.0.0.1)      │  (relayRoute() wrappers)
│                          │                                 │
│                          ▼                                 │
│            src/lib/server/relay/<area>/*.service.js        │  fetch / cache / sync
│                          │                                 │
│                          ▼                                 │
│   featureDir() → RELAY_DATA_ROOT  (prod /mnt/data-dir/     │  JSON via ManagedFile
│                  gaming-journal/relay/)                    │
└────────────────────────────────────────────────────────────┘
```

- **Routing:** `/relay/api/<x>` is served by a concrete SvelteKit handler at `src/routes/relay/api/<x>/+server.ts`, wrapped by `relayRoute(feature, handler)` (`src/lib/server/relay/shared/route-helpers.ts`). There is **no** catch-all proxy and **no** `RELAY_URL` — both removed at decommission.
- **Self-serve for SSR:** `+page.server.ts` / `+layout.server.ts` / services call `journalRelayBase()` = `http://127.0.0.1:$PORT/relay`, hitting the same concrete routes.
- **Boot:** `src/hooks.server.ts` → `bootRelay()` in `src/lib/server/relay/boot.js`. Fast-boot loads sidecar indexes and refreshes in the background; schedulers run only when `ENABLE_SCHEDULERS=true` (prod). See `docs/server/core/startup.md`.
- **Data:** under `featureDir('<area>')` (`shared/data-root.js`), root = `RELAY_DATA_ROOT`. Prod `/mnt/data-dir/gaming-journal/relay/`.
- **Dev read-forward:** `RELAY_FORWARD[_<FEATURE>]` (via `relayRoute`) can forward a dev instance's reads to the prod journal so dev never writes the NAS — the one surviving use of the forward mechanism.

## New per-game section / feature recipe

1. Service in `src/lib/server/relay/<feature>/<feature>.service.js` (cache via `ManagedFile` or `createPersistedIndex`).
2. Route(s) at `src/routes/relay/api/<feature>/+server.ts`, wrapped with `relayRoute('<feature>', handler)`.
3. Scheduler (if any) started from `boot.js` via `startScheduler('<feature>', …)`, closer via `registerCloser`.
4. The ITAD triad (`src/lib/server/relay/itad/` + `src/routes/relay/api/itad/`) is the reference template.

## Per-area deep dives — `docs/server/`

| Area | Docs |
|------|------|
| `core/` | `startup.md` (boot), `sync-tick.md` (the 30-min tick), `managed-file.md` |
| `steam/` | account, achievements, applist, community-reviews, discovery, featured, games, images, news, now-playing, play-log, player-counts, player-stats, progress-suggest, recently-played, reviews-api, reviews-scraper, sessions, store, upcoming, videos, wishlist |
| `external/` | igdb, nexus, pcgw, protondb, reddit |
| `guides/` | fetching, job-queue, parsing, search |
| `hltb/` · `itad/` · `system/` | hltb · itad · pin, provision, recommend |

Format spec: `docs/server/guidance.md`. **mail** (→ `emails` app) and **sms** (→ `beacon`) left the journal at decommission and are intentionally not documented here.
