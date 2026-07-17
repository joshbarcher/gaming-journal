# Folding the relay server into gaming-journal — migration plan

**Goal:** absorb every relay feature this app uses into the SvelteKit server itself, so
there is one repo, one process, one deploy — without losing data or breaking the web app,
the RN app, or live play sessions. Mail + SMS (the non-gaming features) stay in the relay
until their own apps absorb them; the relay then retires.

**Status:** plan drafted 2026-07-16, decisions locked same day. Nothing migrated yet.

**Decisions (2026-07-16):**
- Ops/process management per `C:\dev\deployment.md` — prod is the Linux NUC
  (`root@192.168.86.65`), pm2 + process-mgr one-click deploys, NAS mounted at
  `/mnt/data-dir` (the `\\192.168.86.74\app-data` UNC path is the dev-machine view).
- SMS is **already replaced** by the standalone beacon app → relay's sms feature is
  dropped, not migrated. Mail is being ported out to its own app in parallel.
- 4 cutover waves as planned.
- `/relay` URL prefix stays permanently.
- Relay data relocates to `\\192.168.86.74\app-data\gaming-journal\relay\`
  (`/mnt/data-dir/gaming-journal/relay/` on the box) — as a **single move at the end**,
  not per-feature (see §7 Data relocation).

---

## 1. Why this is tractable

Three properties of the current system make this a low-drama migration if done in order:

1. **Single URL surface.** Web and RN both call `/relay/*` on *this* app's server, which
   proxies to the relay ([src/routes/relay/[...path]/+server.ts](../src/routes/relay/[...path]/+server.ts)).
   No client talks to `:8050` directly. If we implement relay routes *inside* this app at
   the same `/relay/api/...` paths, clients never notice.
2. **SvelteKit route precedence is the strangler seam.** A concrete route
   (`src/routes/relay/api/itad/[appid]/+server.ts`) always wins over the rest-param
   catch-all (`src/routes/relay/[...path]/+server.ts`). So we migrate feature-by-feature:
   migrated paths serve locally, unmigrated paths keep proxying to the live relay.
   Rollback = disable the concrete route.
3. **No database.** All state is JSON under `$DATA_DIR\relay\<feature>\` on the NAS
   (`\\192.168.86.74\app-data`). The data does not move. The only data risk is
   **two writers on the same files** — managed by a strict single-writer cutover rule (§5).

## 2. Target architecture

```
gaming-journal (one Node process, adapter-node, prod on 192.168.86.65)
├── SvelteKit UI (unchanged)
├── src/routes/relay/api/<feature>/**/+server.ts   ← thin route handlers (ex-router+controller)
├── src/routes/relay/images|videos|guides-img/...  ← streaming static endpoints (Range support)
├── src/lib/server/relay/<feature>/                ← service code, ported near-verbatim (.js OK)
├── src/lib/server/relay/shared/                   ← managed-file, map-chunked, jitter/sleep,
│                                                     getAllGames, cache-manager, metrics/tracked,
│                                                     browser (Puppeteer+stealth), logger glue
└── scheduler harness in hooks.server.ts           ← env-gated, HMR-safe, graceful shutdown
```

Decisions and rationale:

- **Native SvelteKit routes, not an embedded Express app.** The router/controller layers
  are deliberately thin (per relay conventions) — rewriting them as `+server.ts` is the
  small part. Services carry all the logic and port nearly verbatim (plain ESM JS imports
  fine from a TS SvelteKit server). Embedding Express in a custom adapter-node entry would
  work but leaves two idioms forever and complicates `vite dev`.
- **Services port verbatim first, including `managed-file.js`.** Its on-disk format
  (backups, recovery files) must stay byte-compatible with existing NAS data — that is the
  "no data loss" guarantee. Do **not** rewrite ported services onto `store-file.ts` during
  the move; converge later if ever. (`store-file.ts` remains the standard for *new*
  journal services.)
- **Keep the `/relay/*` URL prefix permanently.** Renaming to `/api/*` would touch every
  client (web + RN) for zero functional gain. Optional cosmetic alias later.
- **Schedulers live behind a harness, not bare module side-effects:**
  - `ENABLE_SCHEDULERS=true` only in prod `.env` on the box. Dev machines read the NAS but
    never run background syncs (today dev already reads NAS via `hooks.server.ts`; writes
    happened on the prod relay — this preserves that property).
  - Per-feature override (`SCHED_ITAD=off`) for surgical disable.
  - Idempotent start guards via a `globalThis` registry so vite dev SSR reload / HMR can't
    double-start pollers.
  - All syncs stay wrapped in `tracked('<feature>', fn)` — metrics service migrates in the
    foundation phase so dashboard history is continuous.
- **Graceful shutdown** extends the existing handler in
  [src/hooks.server.ts](../src/hooks.server.ts): close Puppeteer browsers, flush
  ManagedFile buffers (60s write window!), flush metrics — mirroring relay `server.js`.

### Static media (needs care)

Relay serves `/images/steam`, `/images/reddit` (+webp negotiation via `serveWithWebp`),
`/images/nexus`, `/videos/steam`, `/videos/reddit`, `/guides-img` straight off the NAS.
These become streaming `+server.ts` endpoints under `src/routes/relay/...`:

- **Must support HTTP `Range`** (video seeking breaks without it — Express static did this
  for free; a hand-rolled endpoint must implement it).
- Port `serveWithWebp` for the webp-variant negotiation.
- Path-traversal guard (resolve + prefix check) since we're hand-streaming from disk.
- Correct cache headers (long-lived immutable for images).

### On-demand writes from dev machines

The 202-pending `syncOne()` pattern writes on cache miss. Today a dev hitting a game page
triggers the write **on the prod relay**; after folding, a dev instance would write to the
NAS directly from the dev machine — concurrently with prod's schedulers. Mitigation: a
shared route wrapper honors `RELAY_FORWARD=http://192.168.86.65:<port>` — when set (dev
default), migrated routes *forward* to the prod journal instead of executing locally.
The same wrapper doubles as the per-feature rollback flag in prod.

## 3. What migrates, what doesn't

| Migrates (gaming) | Stays in relay (for now) | Relay-internal — absorb or retire |
|---|---|---|
| steam (store, stats, account/sessions, snapshots, applist, adult-content, achievements, news, discover/featured, upcoming, releases, community-reviews, player-counts, videos/images) | mail (googleapis) → being ported to its own app in parallel (not our workstream) | dashboard + sync-metrics + disk-usage → absorb (journal already has /activity, /coverage, /sloc) |
| now-playing poller + play-log | sms → **already replaced by beacon; drop from relay, do not migrate** | admin router → review contents, absorb what's still relevant |
| hltb, itad, protondb, pcgw, nexus, reddit, guides, home, recommend, pin, progress-suggest, games, wishlist, account, discovery, igdb, imgur, images, browser | | boot.js port-killer → journal's start.js already does this |
| provision.service (backfill), cache-manager, getAllGames, managed-file, map-chunked, metrics/tracked | | activity.js fleet reporting → journal already has its own copy; relay's entry disappears from the fleet at decommission (expected) |

Also migrating:
- `scripts/capture-nexus-session.mjs` (+ wherever the captured session is stored) — the
  Settings adult-mod backfill depends on it.
- Relay `tools/` — inventory and move what the gaming features use.
- `docs/features/*` (core, external, guides, hltb, itad, steam, system) → this repo's
  `docs/features/`, merged with the existing set (`guidance.md` format already matches).
- Relay tests → rewritten as vitest suites per feature as each feature moves.

**Inventory items to confirm during Phase 0** (small, but check before assuming):
- `multer` — not referenced in any service; find which router uses it (upload endpoint?)
  or drop the dep.
- `@anthropic-ai/sdk` — progress-suggest runs via `claude -p` CLI now (`USE_CLAUDE_CLI`);
  confirm the SDK path is dead or keep it as fallback.
- `admin` and `dashboard` router contents — what's still load-bearing.
- Anything else on the LAN hitting relay gaming endpoints directly (assumed: nothing).

### New dependencies for this repo

`puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, `cheerio`, `sharp`,
`minisearch`, `fast-xml-parser`, `sax` (+ `multer` only if actually used by a gaming
feature). **Not** `googleapis` (mail-only), **not** `express`. Mark heavy natives
(`puppeteer`, `sharp`) as `ssr.external` in vite config so dev SSR doesn't try to
transform them; adapter-node externalizes node_modules for prod builds already.

### Env consolidation (prod box)

Merge into the journal's server env layering (`/home/jarcher/gaming-journal/.env*`, per
`C:\dev\deployment.md` §4a/§6 conventions): `STEAM_API_KEY`, `STEAM_ID`,
`STEAM_VANITY_URL`, `ITAD_API_KEY`, `ITAD_COUNTRY`, `ITAD_SYNC_INTERVAL_HOURS`,
`IGDB_CLIENT_ID/SECRET`, `REDDIT_USER_AGENT`, `REDDIT_SYNC_INTERVAL_HOURS`,
`NEXUS_API_KEY`, `NEXUS_MOD_COUNT`,
`NEXUS_SYNC_INTERVAL_HOURS`, `USE_CLAUDE_CLI`, plus the new
`ENABLE_SCHEDULERS` / `RELAY_FORWARD` knobs (key list verified against the box
2026-07-16). `MAIL_*` stays with the relay.
`ENABLE_SCHEDULERS` follows the exact precedent of communities' `SCRAPE_ENABLED`: true
only in the prod env layer, false in the shared `.env`, dev is reader-only.

Prod paths are POSIX (`DATA_DIR=/mnt/data-dir`); the UNC share is only how dev machines
see it. Relay code builds paths with `path.join` off `DATA_DIR`, so nothing is
Windows-specific — but Phase 0 includes a grep for hardcoded separators/UNC literals.

### Ops changes on the box (per deployment.md)

- **Puppeteer/Chrome — the known fleet gotcha (deployment.md §6):** process-mgr's update
  flow forces `PUPPETEER_SKIP_DOWNLOAD=true`, so Chrome must live in a project-local
  cache. *Verified 2026-07-16:* the relay has **no** project cache — its Chrome lives in
  the shared `/root/.cache/puppeteer` (predates the fleet-wide skip). For the journal,
  follow the fleet convention instead: add
  `PUPPETEER_CACHE_DIR=/home/jarcher/gaming-journal/.puppeteer-cache` to gaming-journal's
  `apps.json` env block (+ `pm2 save`), and one-time
  `PUPPETEER_CACHE_DIR=... npx puppeteer browsers install chrome` in the app dir — before
  Wave 1's first Puppeteer consumer (pcgw). Same post-deploy "could not find Chrome"
  failure mode applies if puppeteer bumps its pinned Chrome — same manual fix.
- **`claude` CLI for progress-suggest — RESOLVED (2026-07-16):** the relay's
  `progress-suggest-cli.service.js` prepends `dirname(process.execPath)` to the child
  PATH (pm2 gives a minimal PATH; the npm-global `claude` sits next to the nvm node
  binary — verified on the box: `/root/.nvm/versions/node/v24.18.0/bin/claude`, v2.1.206)
  and strips `ANTHROPIC_API_KEY` so the CLI bills the OAuth subscription. The verbatim
  port carries this behavior; same node + same root user ⇒ works unchanged for the
  journal. Just smoke-test one suggest job at Wave 2 cutover.
- **Reverse dependency (verified in relay `.env.production`):** the relay POSTs generated
  trackers to the journal's `/api/pages` via `JOURNAL_URL` (`:8061`). After fold-in this
  becomes an in-process call — drop the HTTP hop when porting progress-suggest (Wave 2).
- **Registry edits at decommission:** remove the relay from `/home/jarcher/apps.json`
  (+ local mirror `C:\dev\media-server\files\apps.json`), `pm2 delete relay-server &&
  pm2 save`, remove from process-mgr's `apps.config.json` (+ local mirror), restart
  process-mgr. No registry edits are needed for routine wave deploys — those are normal
  `POST /apps/gaming-journal/update` calls (plus the relay's own pull/restart when its
  `server.js` shrinks).

## 4. Phases

### Phase 0 — Prep (no behavior change)

1. **Freeze** new relay feature work for the duration (bug fixes fine).
2. **Endpoint inventory:** script that walks relay routers and emits the full route list;
   cross-check against `contracts/` and both clients' API layers. This is the migration
   checklist and the parity-test corpus.
3. **Backup:** snapshot `\\192.168.86.74\app-data\relay` (robocopy to a dated sibling dir).
   Repeat before every cutover wave.
4. **Parity harness:** a script that replays the inventory's GET corpus against two bases
   (live relay vs local implementation) and deep-diffs JSON (ignoring `fetchedAt`-class
   fields). This is the main correctness gate for every wave. `npm run verify-contracts`
   is the second gate.
5. **Confirm process management on the box:** how relay is kept alive on 192.168.86.65
   (task scheduler? manual?), which account, NAS credentials — journal inherits this.

### Phase 1 — Foundation (journal-side scaffolding, still no cutover)

1. Port `src/lib/server/relay/shared/`: `managed-file.js` (verbatim), `map-chunked`,
   `jitter/sleep`, `getAllGames`, `cache-manager`, logger adaptation.
   Introduce **one data-root constant** used by every ported storage helper (and the
   existing direct reads in `hooks.server.ts`):
   `RELAY_DATA_ROOT = env.RELAY_DATA_ROOT ?? join(DATA_DIR, 'relay')`. During the whole
   migration it points at the *old* location; the final relocation (§ Phase 6) is one
   env flip. No ported service may call `join(DATA_DIR, 'relay', ...)` directly.
2. Scheduler harness in `hooks.server.ts` (env-gated, HMR-safe, shutdown hooks).
3. Port **metrics** (`tracked`, sync-metrics, disk-usage) — everything after this reports
   runs identically.
4. Route wrapper implementing `RELAY_FORWARD` / per-feature rollback flags.
5. Streaming static endpoint helper with Range + webp support (used by several waves).
6. Vitest patterns for ported services (relay tests translate per feature).

### Phase 2 — Wave 1: read-mostly, low-state features

`protondb`, `hltb` (+retry scheduler), `itad` (+scheduler — the canonical template proves
the whole recipe), `pcgw` (first Puppeteer consumer), `community-reviews`.

**Wave re-assignment (2026-07-16, dependency-verified against actual imports):** the
original wave-1 list was optimistic — several features import unported internals and
move out: `pin` → Wave 2 (imports reddit's `refreshForPin`), `news` → Wave 2 (imports
the guides content parser), `imgur` → Wave 2 (imports the shared browser; no router of
its own), `player-counts` + `discovery` → Wave 3 (discovery imports syncOne from six
features including steam store/images), `recommend` + `home` → Wave 3 (import
`games.service.getAll` and steam internals). `igdb` has no router — it ports alongside
its first consumer.

Cross-feature notes discovered during the ITAD port (apply to the whole wave):
- Steam cache files (`games.json`, `wishlist.json`) stay relay-owned until Wave 3;
  ported features read them via `shared/steam-caches.js` (plain-fs, read-only) so the
  journal never holds a write-capable ManagedFile handle on files it doesn't own.
- Relay's in-memory games/wishlist caches embed ITAD prices. After ITAD cutover, a
  journal-side ITAD sync can't trigger the relay's `cache-manager.rebuild` — those
  caches catch up on their own ~30-min steam tick. Temporary until Wave 3; the ported
  `rebuild('games','wishlist')` call warns "Unknown cache" harmlessly until then.

Each feature follows the **per-feature recipe** (§6). Cutover per §5.

### Phase 3 — Wave 2: media + scrapers

Static media endpoints (`/relay/images/*`, `/relay/videos/*`, `/relay/guides-img`),
`videos`, `nexus` (+ session capture script), `reddit` (browser + scheduler + media
downloads), `guides` (biggest single feature — minisearch index, image pipeline, parse
tools), `progress-suggest` (SSE streaming through SvelteKit — verify streaming works
through the adapter; it does, but test explicitly; needs `claude` CLI on the box).

**Cutover-boundary discovery (2026-07-16):** the relay's 30-minute steam tick
lives inside `now-playing.service` (Wave 4) and drives library/achievements/
sessions/player-counts syncs *and* `provisionNewGames`. Splitting data ownership
of those files between waves would need forward-flags plus relay-side HTTP shims
for store/images — pure bug surface. **Decision: Waves 3+4 cut over in ONE
window** (after the Wave-4 restart-safety fix), while code porting stays phased.
Wave-2 features are tick-independent (own schedulers) and keep their own window.

**Wave-3 debts recorded during Wave 2** (search "Wave 3" in-file comments too):
- guides `mark-used` calls a no-op `invalidateHomeCache` until home ports — restore it.
- guides IGN disambiguation reads `steam/store/<id>.json` directly instead of
  `games.service.getOne` — swap back when games.service ports.

### Phase 4 — Wave 3: core Steam data

`games`, `wishlist`, `provision` backfill, `applist`, `adult-content`, `achievements`
(+schema scraper browser), `store`, `stats`, `upcoming`, `releases`, `discover/featured`
poller, snapshot scheduler. High fan-out but read/sync-shaped; the risk is scheduler
double-write, so cutover discipline matters most here.

### Phase 5 — Wave 4: live-session machinery (LAST, gated)

`now-playing` poller, `play-log`, `sessions`, `account` (depends on play-log),
**`home`** (moved from Wave 3 on 2026-07-16: `home.service` imports
`getLastPlayedMap`/`getSessions` from play-log — it's session-coupled). Also the
`GET /api/steam/now-playing` route, which Wave 3 deliberately does NOT create —
the catch-all proxy keeps serving it from the relay until this wave (SvelteKit
route precedence makes the intra-router split free).

**Gate: restart-safety work first.** Today, restarting the relay mid-play can flap and
close the active session ([memory: relay restarts disrupt sessions]). After folding,
*every journal deploy* restarts the poller — the current pain would attach to our most
frequent deploy path. Before this wave:

- Persist active-session state so the poller resumes across restarts instead of
  re-deriving (and flapping) — fix the root cause in the relay codebase first, verify it
  over a real restart-while-playing, *then* port the fixed version.
- Until this wave completes, journal deploys remain safe (poller still lives in relay);
  after it, deploys are safe because of the fix. There is no window where deploys are
  more dangerous than today — as long as this ordering holds.

### Phase 6 — Data relocation (single move, after all waves)

Relay data moves from `$DATA_DIR/relay/` to `$DATA_DIR/gaming-journal/relay/`
(feature dirs stay cleanly separated from the journal's existing flat store-files in
`$DATA_DIR/gaming-journal/`).

**Why at the end, not per-feature:** relay services cross-read each other's data
(`getAllGames` reads steam's `games.json`; provision, home, account all read other
features' files). A per-feature move would need a feature→root resolution map during the
transition — real complexity and bug surface for zero benefit. Moving once at the end
means data paths never change while code is in motion: one variable changes per step.

**Protocol** (media dirs are large — use two-pass rsync to keep downtime to minutes):

1. Bulk copy while the app runs: on the box,
   `rsync -a /mnt/data-dir/relay/ /mnt/data-dir/gaming-journal/relay/ --exclude mail`
   (exclude anything not ours that still lives there).
2. Stop gaming-journal (`pm2 stop gaming-journal`) — check now-playing is idle first.
3. Delta rsync (same command — picks up writes since pass 1; fast).
4. Flip `RELAY_DATA_ROOT=/mnt/data-dir/gaming-journal/relay` in the prod env; restart.
5. Verify: dashboard scheduler runs green, spot-check pages, confirm new writes land in
   the new tree (`find -newer` sentinel).
6. **Keep the old tree frozen as rollback** for a comfortable window (rollback = flip the
   env var back). Delete it at decommission time.
7. Update anything that references the old root: disk-usage metrics scan roots, backup
   scripts, `capture-nexus-session.mjs` output path, docs.

Naming note: the `relay/` segment is historical once the relay is gone. If a
better-named home is ever wanted (`server/`, feature dirs directly under
`gaming-journal/`), it's the same stop → rsync → env-flip procedure — cheap, and
deliberately deferred.

### Phase 7 — Decommission + docs

1. Relay now serves only mail (sms is already beacon's — delete it from relay in an
   early wave). It keeps running until the mail port completes; remove gaming
   routers/schedulers from `server.js` as waves complete (already done per-cutover),
   then retire the repo/process entirely: registry removals per §"Ops changes on the
   box", delete the frozen `$DATA_DIR/relay` tree.
2. Delete the catch-all proxy route **last** (it's also the `RELAY_FORWARD` dev mechanism
   — decide whether to keep it as dev-forwarding-to-prod convenience).
3. Rewrite [docs/relay-server.md](relay-server.md) as an "internal server architecture"
   doc; merge relay `docs/features/*` here; update `CLAUDE.md`s and memory files
   (several say "needs relay redeploy" / "server half lives in relay-server").
4. RN app: no code changes expected (everything rides `/relay/*` via the gateway) — but
   run the full RN smoke pass anyway; check the hardcoded `192.168.86.65` in
   `react-native/src/app/(drawer)/settings.tsx` for anything port-specific.

## 4b. Wave 1 cutover runbook — ✅ EXECUTED 2026-07-16 ~23:56Z

**Wave 1 is LIVE**: itad/protondb/hltb/pcgw/community-reviews serve from the
journal with schedulers running (`RELAY_FORWARD_<X>=local` in `.env.local`);
the relay 404s them directly; all other features still forward. Verified:
scheduler start logs, local-serve content-type fingerprints, relay 404s,
hltb retry's first real pass, forwards intact.

**Wave 2 status:** relay shrink shipped (`6ee2ac6`, relay tests 971/0 — guides/
reddit/nexus/progress-suggest/news unmounted; **pin deliberately stays relay-side
until Wave 3+4**, welded to the still-relay-owned now-playing poller, accepting a
narrow dual-writer overlap on the pinned game's reddit entry; admin news-refresh
proxies to the journal). **Window pending a quiet now-playing** — watcher armed.
Window = append to `.env.local`: `RELAY_FORWARD_GUIDES/REDDIT/NEXUS/
PROGRESS_SUGGEST/NEWS=local`, delete the `SCHED_REDDIT|SCHED_NEXUS=off` lines,
then relay pull + restart both.

The original (now historical) runbook follows.

### Original Wave-1 runbook (historical)

**Scope:** itad, protondb, hltb, pcgw, community-reviews move to the journal.
All five are code-complete with live parity green (6/6, 4/4, 4/4, 5/5, 4/4) and
2,075 tests passing (346 added by the migration so far).

**Two-writer hazards found while preparing this wave, and their mitigations:**

1. **Shared metrics buckets.** The relay keeps writing `metrics/runs-<month>.json`
   for its remaining features; journal-side runs now write to
   `metrics/journal/runs-<month>.json` (identical format, sibling dir — see
   `metricsDir()` comment). Dirs merge at decommission. The journal's disk-usage
   scheduler stays **off** (`SCHED_DISK_USAGE=off`) until the relay's nightly scan
   retires — the relay still owns `metrics/disk-usage.json`.
2. **Relay's discovery worker** imports `syncOne/syncGame` from all five cut
   features — left alone it would keep writing their entry files. Relay-side edit:
   discovery calls the journal over HTTP instead
   (`POST ${JOURNAL_URL}/relay/api/<feature>/sync/<appid>`, fire-and-forget —
   `JOURNAL_URL` is already in the relay's prod env).
3. **Relay's dashboard manual actions** (`actions.js`) can trigger the five cut
   syncs relay-side — those five entries are removed in the same relay edit.

**Preflight — DONE 2026-07-16 (states which are already in place):**
1. ✅ Journal committed + pushed (Waves 0–3 code).
2. ✅ Env layering: `.env.production` (tracked) carries the non-secret constants
   incl. the **global `RELAY_FORWARD=http://localhost:8050`** — every migrated
   route forwards to the relay until its window sets `RELAY_FORWARD_<X>=local`.
   Secrets + window flips live in the **untracked** `.env.local` (loaded by
   start.sh `--env-file-if-exists`); all provider keys already copied there
   from the relay's env, server-side.
3. Chrome install happens with the first deploy's `npm install`
   (`PUPPETEER_CACHE_DIR` set in the committed env; if puppeteer skips the
   download under process-mgr, run the manual install from §Ops once).
4. Relay repo shrink — **prepared as a verified patch**:
   [scripts/relay-wave1-shrink.patch](../scripts/relay-wave1-shrink.patch)
   (`git apply --check` clean against the relay tree; every hunk was generated
   by assert-unique string transforms and syntax-checked). Companion new file
   `src/services/journal-sync.js` (the HTTP shim) is already in the relay
   working tree. Apply + test + ship:
   ```
   cd C:\dev\relay-server
   git apply C:\dev\gaming-journal\scripts\relay-wave1-shrink.patch
   npm test
   git add -A && git commit -m "Wave-1 fold-in shrink: five features move to gaming-journal" && git push
   ```
   Contents: `server.js` unmounts the five routers + scheduler starts + boot
   build + pcgw browser close; `metrics/actions.js` drops the five manual
   triggers; `metrics/sources.js` clears their `syncable`/`scheduled` flags (so
   the drift test and staleness warnings stay truthful); `provision.service.js`
   + `discovery/discovery.worker.js` call the journal over HTTP via
   `journal-sync.js` instead of importing the cut services (mitigation 2).
5. Backup on box:
   `rsync -a /mnt/data-dir/relay/{itad,protondb,hltb,pcgw} /mnt/data-dir/relay/steam/community-reviews /mnt/data-dir/backups/relay-wave1-$(date +%F)/`
6. Confirm now-playing is idle.
7. (Recommended) dev `.env` gets `RELAY_FORWARD=http://192.168.86.65:8061` so dev
   machines forward on-demand syncs to prod instead of writing the NAS.

**Step 1 — deploy the journal (safe any time, even mid-session):**
`curl -X POST http://192.168.86.65:8008/apps/gaming-journal/update`
With the global forward staged, the deployed journal behaves byte-identically
to today (everything proxies to the relay; no schedulers run).

**Step 2 — apply + ship the relay shrink patch** (commands earlier in this section).

**Step 3 — the Wave-1 window (needs now-playing idle, ~1 minute):**
```
ssh -i ~/.ssh/claude_media_server root@192.168.86.65 "cat >> /home/jarcher/gaming-journal/.env.local <<'EOF'
ENABLE_SCHEDULERS=true
RELAY_FORWARD_ITAD=local
RELAY_FORWARD_PROTONDB=local
RELAY_FORWARD_HLTB=local
RELAY_FORWARD_PCGW=local
RELAY_FORWARD_COMMUNITY_REVIEWS=local
# not-yet-cut schedulers stay off until their windows:
SCHED_REDDIT=off
SCHED_PIN=off
SCHED_NEXUS=off
SCHED_FEATURED=off
SCHED_APPLIST=off
SCHED_GAMES_CACHE=off
SCHED_WISHLIST_CACHE=off
SCHED_PLAYER_COUNTS_CACHE=off
SCHED_PROVISION=off
EOF
cd /home/jarcher/relay-server && git pull && pm2 restart relay-server && pm2 restart gaming-journal && pm2 save"
```
Wave-2 window later = five more `RELAY_FORWARD_<X>=local` lines (GUIDES, REDDIT,
PIN, NEXUS, PROGRESS_SUGGEST, NEWS) + delete their `SCHED_*=off` lines + that
wave's relay shrink + restarts. Combined Wave-3+4 window = the rest.

**Verify:** journal GETs return data for all five features; game page sections
(prices / HLTB / ProtonDB / PCGW / community reviews) render on web + RN;
`pm2 logs gaming-journal` shows `[sched] itad|protondb|hltb started`; new run
records appear under `metrics/journal/`.

**Rollback (no data surgery — formats identical):** journal env:
`RELAY_FORWARD_<FEATURE>=http://192.168.86.65:8050` + `SCHED_<FEATURE>=off`,
restart journal; revert the relay shrink commit, pull + restart relay.

## 5. Cutover protocol (per wave — the data-safety core)

The invariant: **for any feature, exactly one process owns its files/schedulers at any
moment.** JSON files + ManagedFile's batched 60s flushes mean two writers = corruption
or silent lost updates.

Per wave, batched into a single relay restart (restarts are disruptive — batch, per
existing practice):

1. Verify parity locally: parity harness green against real NAS data (read-only), vitest
   green, `verify-contracts` green.
2. Check `/relay/api/steam/...` now-playing is **idle** (no active session) before
   touching the relay.
3. NAS backup snapshot of the affected feature dirs.
4. Deploy shrunken relay: wave's routers unmounted + schedulers not started (code edit in
   `server.js`, kept in a branch per wave for easy revert).
5. Deploy journal with the wave's routes + schedulers enabled.
6. Restart both (relay first, then journal), in one maintenance window.
7. Smoke: parity spot-checks against prod, dashboard shows scheduler runs under the
   journal, Playwright smoke of affected pages, RN spot-check.
8. **Rollback path** (per feature, no data surgery needed since formats are identical):
   flip the feature's journal flag to forward-to-relay, re-mount in relay, restart.

## 6. Per-feature recipe (repeatable)

1. Copy `relay:src/services/<feature>/` → `src/lib/server/relay/<feature>/` verbatim
   (same file names; `.js` is fine). Adjust imports to shared/.
2. Create `src/routes/relay/api/<feature>/.../+server.ts` files mirroring the router's
   paths exactly (SvelteKit's specificity ordering replaces "static before param" —
   concrete route files inherently win). Fold the controller's try/catch → status-code
   logic (202-pending / 409-busy) into these handlers, wrapped by the rollback/forward
   helper.
3. Register scheduler(s) in the harness.
4. Port the feature's relay tests to vitest (isolated, self-cleaning, never touch live
   data — same rules as today).
5. Run parity harness for the feature's endpoints (local vs live relay).
6. Add to the current wave's cutover manifest.
7. After cutover: migrate the feature's `docs/features/` doc into this repo.

Do **not** fix known feature bugs mid-port (e.g. the HLTB stale-Steam-base pin issue in
`docs/play-times.md`) — port as-is, verify parity, fix after. Parity is the only
correctness definition during migration.

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Two writers corrupt NAS JSON | Single-writer invariant + batched cutover (§5); backups per wave |
| Journal deploys kill live play sessions | Wave 4 gated on restart-safe poller (§ Phase 5) |
| Hand-rolled static endpoints break video seeking | Range support required + tested in Phase 1 helper |
| ManagedFile 60s buffer lost on shutdown | Flush in extended shutdown handler (Phase 1); journal already has a 5s-timeout shutdown pattern |
| vite dev double-starts pollers (HMR/SSR reload) | globalThis start-guards; `ENABLE_SCHEDULERS` off in dev anyway |
| Dev machines writing NAS via on-demand syncs | `RELAY_FORWARD` to prod journal in dev `.env` |
| Puppeteer/sharp break under vite SSR | `ssr.external`; prod unaffected (adapter-node externals) |
| SSE (progress-suggest, reddit sync progress) through SvelteKit | Explicit streaming test in Wave 2 before cutover |
| `claude` CLI / Chrome / NAS creds missing for the journal's process account on the box | Phase 0 item 5: confirm process account + environment |
| Schema drift during port | `verify-contracts` + parity harness on every wave |
| Relay decommission breaks the mail app | Mail stays in the (shrunken) relay until its own port completes — journal never hosts it |
| Chrome missing after a deploy (fleet-wide `PUPPETEER_SKIP_DOWNLOAD`) | Project-local `.puppeteer-cache` + `PUPPETEER_CACHE_DIR` in apps.json, per deployment.md §6; known symptom + manual fix documented there |
| Data relocation loses in-flight writes | Two-pass rsync with the app stopped for the delta pass; old tree kept frozen as rollback (§ Phase 6) |
| `serveWithWebp` writes sidecars on the request path — a dev instance serving images locally would write the NAS | Dev runs `RELAY_FORWARD`, so image requests are proxied to prod; only the prod box converts |
| Cross-feature reads break under a partial data move | Avoided by design: single move at the end, single `RELAY_DATA_ROOT` constant |
