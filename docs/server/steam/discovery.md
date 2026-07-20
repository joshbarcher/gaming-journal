# Discovery

Enriches non-owned "discovered" games (top-100 by player count) with the full external-source stack. Uses a Worker Thread queue to keep enrichment I/O off the main event loop. Lives in `src/lib/server/relay/discovery/discovery.service.js`.

## Data flow

1. `enqueue(appid)` checks `_isEnriched(appid)` — reads `steam/store/{appid}.json` and returns true if it has a `name`.
2. If not enriched and not already queued: adds to `_queued: Set<appid>` and posts `{ type: 'enqueue', appid }` to the worker.
3. `discovery.worker.js` runs `enrich(appid)` per queued appid: store details, then game images, screenshots, community reviews; then (if the store returned a name) ITAD + HLTB + PCGW in parallel; then ProtonDB.
4. On completion the worker posts `{ type: 'done', appid, name }`; the main thread `patchName(appid, name)` updates the player-counts index in place (no full rebuild).
5. On failure the worker posts `{ type: 'error', appid, err }`.

### Worker lifecycle
- Worker spawned lazily on first `enqueue()` (`_getWorker()`), from `discovery.worker-boot.js` resolved at `process.cwd()/src/lib/server/relay/discovery/` (worker_threads bypass Vite; the boot shim registers a `.js`→`.ts` resolve fallback).
- Worker `error`/`exit` sets `_worker = null` — respawns on the next `enqueue()`.
- `_queued` entries are cleared on `done`/`error`.

### Callers
- `steam/player-counts.service.js` — enqueues top-100 global appids that are new or lack a name (`if (isNew || !name) enqueueDiscovery(appid)`).

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/discovery/discovery.service.js` | `enqueue`, `queueSize`, `_getWorker`, `_isEnriched`, `_queued` |
| `src/lib/server/relay/discovery/discovery.worker.js` | Worker thread — `enrich()` for a single appid |
| `src/lib/server/relay/discovery/discovery.worker-boot.js` | Worker entry: `.js`→`.ts` resolve shim, then loads the worker |
| `src/lib/server/relay/steam/player-counts.service.js` | `patchName` — in-place name update; the only enqueue caller |

## Common questions

**Q: Which sources does enrichment fetch?**
All of: store details (`steam/store/{appid}.json`), game images + screenshots (`steam/images/...`), community reviews, ITAD, HLTB, PCGW, and ProtonDB. (This is broader than the pre-fold-in relay, where the worker called the journal over HTTP; here the worker imports the local ported services directly.)

**Q: Why a Worker Thread?**
Enrichment is slow (many HTTP calls + Puppeteer for PCGW). Offloading keeps the main event loop responsive during large discovery batches.

## Gotchas

- The worker never exits on drain — it idle-polls its internal queue every 500ms and sleeps 2s between games.
- `_queued` is main-thread module state; a restart clears it, so unenriched appids must be re-enqueued (player-counts does this each tick).
- There is no in-process cache and no `getOneDiscovered()` here — the Discover single-game endpoint reads the store/images files from disk directly.
