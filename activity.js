// @ts-nocheck -- vendored drop-in; not authored against any consumer's strict/checkJs config.
/**
 * @fileoverview Zero-dependency runtime-activity reporter for Node.js apps, plus
 * the shared `/activity` endpoint contract for the process-mgr fleet. It answers
 * two operational questions per app: "how much network traffic is this server
 * handling?" and "how much is it writing to the NAS?" — so excessive traffic or
 * disk churn can be traced back to a specific app instead of guessed at.
 *
 * Ships two adapter pairs so the same core works under Express or SvelteKit (or
 * anything on the standard Fetch API) — pick the pair that matches your server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SHAPED DIFFERENTLY FROM sloc.js / coverage.js
 * ─────────────────────────────────────────────────────────────────────────────
 * sloc/coverage measure a STATIC property of the code — they compute on demand
 * and give the same answer whether called once or a thousand times. Activity is
 * CUMULATIVE RUNTIME state: request and write counts only mean something if the
 * running process tallies them continuously. So this file installs a lightweight
 * tracker at boot (an Express middleware for inbound requests; an optional hook
 * off your file-store for NAS writes) and the endpoint just serialises the
 * running totals. The counters are MONOTONIC since process start — process-mgr
 * computes rates by diffing successive polls (Prometheus-style), so this file
 * ships no clocks or rolling windows of its own. A counter that resets to zero on
 * restart is a feature here: right after a restart you see the burst climb from 0.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SETUP
 * ─────────────────────────────────────────────────────────────────────────────
 * Copy this file into the project root, then wire up the tracker + endpoint.
 *
 * Express:
 *   import {
 *     installActivityTracker, createActivityMiddleware,
 *     createActivityRoute, createActivityDashboardRoute,
 *   } from './activity.js'
 *
 *   installActivityTracker({ name: 'my-app', nasDir: '/mnt/nas/my-app' })
 *   app.use(createActivityMiddleware())          // counts inbound requests
 *   app.get('/activity', createActivityRoute({ name: 'my-app' }))
 *   app.get('/activity/dashboard', createActivityDashboardRoute({ name: 'my-app' }))
 *
 * SvelteKit (count requests in the `handle` hook; serve the two routes as
 * `+server.js`/`.ts` GET exports — adjust the relative import depth to wherever
 * you copied activity.js, typically the project root). Install the tracker once
 * at module load, then count every request EXCEPT `/activity*` so the endpoint —
 * and the dashboard polling it — don't inflate the numbers they report:
 *   // src/hooks.server.js  (or .ts)
 *   import { installActivityTracker, recordRequest } from '../activity.js'
 *   // Point nasDir at the SAME directory the app actually writes to. Prefer the
 *   // app's own path helper over a hard-coded string so it stays correct:
 *   //   import { APP_DATA_DIR } from '$lib/server/data-dir'  → nasDir: APP_DATA_DIR
 *   installActivityTracker({ name: 'my-app', root: process.cwd(), nasDir: process.env.DATA_DIR })
 *   export async function handle({ event, resolve }) {
 *     const res = await resolve(event)
 *     if (!event.url.pathname.startsWith('/activity')) recordRequest(event.request, res)
 *     return res
 *   }
 *
 * If the app already exports a `handle`, don't clobber it — compose with
 * SvelteKit's sequence():
 *   import { sequence } from '@sveltejs/kit/hooks'
 *   const activityHandle = async ({ event, resolve }) => {
 *     const res = await resolve(event)
 *     if (!event.url.pathname.startsWith('/activity')) recordRequest(event.request, res)
 *     return res
 *   }
 *   export const handle = sequence(existingHandle, activityHandle)
 *
 *   // src/routes/activity/+server.js  (nasDir/name already set by installActivityTracker)
 *   import { createActivityHandler } from '../../../activity.js'
 *   export const GET = createActivityHandler({ name: 'my-app' })
 *
 *   // src/routes/activity/dashboard/+server.js
 *   import { createActivityDashboardHandler } from '../../../../activity.js'
 *   export const GET = createActivityDashboardHandler({ name: 'my-app' })
 *
 * Note: SvelteKit responses are often streamed without a Content-Length, so
 * bytesOut undercounts there (request COUNT is still exact) — see LIMITATIONS.
 *
 * Wiring NAS writes (the part that catches app-made disk churn): the tracker only
 * sees writes it's told about. If your app writes through the shared file-store.js
 * drop-in, pass its onWrite/onDelete hooks so every store write is counted with
 * zero per-call wiring:
 *   import { recordWrite, recordDelete } from './activity.js'
 *   new MyStore({ rootDir, onWrite: recordWrite, onDelete: recordDelete })
 * For writes made another way (a raw fs.writeFile, a stream), call
 * recordWrite(byteLength) at the write site.
 *
 * Requires Node.js 18+. No npm install needed.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE WIRING THIS UP — CHECK FOR ROUTE COLLISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * Same review step as sloc.js/coverage.js — the code doesn't enforce any of it,
 * because the failure mode (two handlers on one path, or one silently shadowing
 * the other) doesn't throw; it just serves the wrong thing until someone notices.
 *
 *   1. Search the target app's routes for an existing '/activity' or
 *      '/activity/dashboard' before adding these. If either is taken, mount at a
 *      different path and pass a matching `dataUrl` to the dashboard factory.
 *   2. Check registration ORDER: mount `/activity` ABOVE any catch-all / SPA
 *      fallback / early 404 handler, and register createActivityMiddleware()
 *      early (before your routes) so it observes every request.
 *   3. In SvelteKit, confirm no `[...catchall]` or `[slug]` route over
 *      `src/routes/activity/` absorbs the request first.
 *   4. If the app already namespaces everything under `/api`, mount there instead
 *      and update `dataUrl` and process-mgr's data/apps.config.json to match.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIRED RESPONSE SHAPE
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /activity must return 200 with this JSON shape (createActivityRoute
 * produces it automatically):
 *
 *   {
 *     "name": "my-app",                 // optional, recommended — self-identifies
 *     "generatedAt": "2026-07-12T12:00:00.000Z",
 *     "root": "/home/jarcher/my-app",   // dedup key: group members sharing a repo
 *                                        //   collapse to one, exactly like /sloc
 *     "startedAt": "2026-07-12T11:46:00.000Z",  // when this tracker began counting
 *     "uptimeSec": 840,
 *     "network": {
 *       "requests": 1043,               // monotonic count since startedAt
 *       "bytesIn":  88213,              // Σ request Content-Length (0 when absent)
 *       "bytesOut": 5522019             // Σ response Content-Length (see LIMITATIONS)
 *     },
 *     "nas": {
 *       "dir": "/mnt/nas/my-app",       // snapshot dir, or null when snapshot is off
 *       "writeOps":     37,             // in-process writes the tracker was told of
 *       "deleteOps":    4,
 *       "bytesWritten": 1994321408,
 *       "recentWrites": [               // PASSIVE — the last writes this process made
 *         { "path": "communities/x/posts/123.json", "mtime": "...", "size": 4096 }
 *       ],
 *       "snapshot": {                   // OPT-IN filesystem view; null unless nasDir set
 *         "scannedAt":        "2026-07-12T12:00:00.000Z",
 *         "totalBytes":       812000000000,
 *         "fileCount":        20431,
 *         "recentWindowSec":  120,
 *         "recentBytes":      734003200,
 *         "recentlyModified": [ { "path": "downloads/vid.mp4.part", "mtime": "...", "size": 734003200 } ],
 *         "truncated":        false     // true if the walk hit its depth/entry caps
 *       }
 *     }
 *   }
 *
 * POSTURE — this file is passive by default. `network.*`, `nas.writeOps/
 * deleteOps/bytesWritten`, and `nas.recentWrites` are all IN-PROCESS: they
 * increment ALONGSIDE requests and writes that already happen, doing no work of
 * their own. `nas.snapshot` is the one exception — an actual filesystem walk —
 * and it is OPT-IN (null unless you set nasDir). Only enable it to catch writers
 * this process can't see (external binaries like yt-dlp / ffmpeg). An app whose
 * writes all flow through recordWrite (e.g. a single atomic-write helper) should
 * leave nasDir OFF: recentWrites already answers "what is this app writing right
 * now" with zero added NAS load. See LIMITATIONS.
 *
 * A consuming app on a non-Node stack just needs to return JSON matching this
 * shape from its own /activity route — the format is the contract.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FUNCTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *   installActivityTracker(options)
 *     Call once at boot. Registers this process's watch config and (re)sets the
 *     count-from timestamp. options: { name, root, nasDir, snapshot }.
 *
 *   createActivityMiddleware()
 *     Express middleware `(req, res, next)` that counts inbound requests and their
 *     Content-Length bytes. Requests to /activity* are excluded so the meter
 *     doesn't measure its own observation. Register it before your routes.
 *
 *   recordRequest(req, res) | recordRequest(bytesIn, bytesOut)
 *     Manual request tally, for frameworks without the Express middleware. Accepts
 *     either a Fetch Request+Response pair (reads Content-Length off both) or two
 *     byte numbers.
 *
 *   recordWrite(bytes|content, relPath?) / recordDelete()
 *     Tally a NAS write / delete. Passive — bumps counters and a bounded
 *     recent-writes ring, no I/O. Pass these as file-store.js's onWrite/onDelete,
 *     or call at any raw write site (ideally the app's single write helper).
 *     recordWrite tolerates a Buffer/string/number; pass the path 2nd for the
 *     recentWrites list.
 *
 *   computeActivity(options?)
 *     Returns the report shape above (minus "name", added by the route factory).
 *     Reads the live counters + recent-writes ring (no I/O) and, ONLY if a nasDir
 *     is configured, additionally attaches a cached filesystem snapshot. options
 *     override the installed config per call.
 *
 *   createActivityRoute(options?) / createActivityHandler(options?)
 *     Express / Fetch-API handlers serving GET /activity.
 *
 *   createActivityDashboardRoute(options?) / createActivityDashboardHandler(options?)
 *     Express / Fetch-API handlers serving the optional self-contained HTML
 *     dashboard: current totals plus live sparklines it builds by polling
 *     `options.dataUrl` (default '/activity') and diffing successive samples.
 *
 *   ACTIVITY_DASHBOARD_STYLE (string)
 *     Exported CSS so a fleet-wide aggregator view (process-mgr only) can reuse
 *     the identical look. Not needed to run /activity on a single server.
 *
 * options (installActivityTracker / computeActivity / route factories):
 *   name      string   Included as "name" in responses. Recommended.
 *   root      string   Reported as "root" (the dedup key). Default: process.cwd().
 *   nasDir    string   Directory to snapshot for filesystem-level write tracking.
 *                       Omit to skip the snapshot (in-process counters still work).
 *   snapshot  object   Snapshot tuning (all optional):
 *     cacheMs         Reuse the last scan this long. Default: 30000 (30s).
 *     recentWindowSec Count a file "recently modified" if touched within this many
 *                     seconds. Default: 120.
 *     maxRecent       Cap the recentlyModified list. Default: 25.
 *     maxDepth        Directory-recursion depth cap. Default: 6.
 *     maxEntries      Total dirents to stat before stopping (sets `truncated`).
 *                     Default: 20000.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NAS SNAPSHOT — OPT-IN, AND KEEP IT CHEAP
 * ─────────────────────────────────────────────────────────────────────────────
 * The snapshot is OFF unless you set nasDir. It is the only active operation this
 * file performs; everything else rides along with work the app already does.
 * Reach for it only when writes bypass recordWrite (an external binary, or raw fs
 * you can't instrument). Walking a large tree over SMB is itself NAS traffic, so
 * even when enabled the snapshot must never become the load it's meant to detect.
 * Three guards, all tunable above:
 *   - cacheMs (30s default): the walk runs at most once per cache window no matter
 *     how often /activity is polled; concurrent polls during a miss share one walk.
 *   - maxDepth / maxEntries: the walk stops early on a huge tree and sets
 *     `truncated: true` rather than reading the whole share. totalBytes/fileCount
 *     are then lower bounds — still useful as a trend, honest about being partial.
 *   - recentWindowSec keeps recentlyModified small and relevant (active writes),
 *     which is the field you actually watch; it is not a full directory listing.
 * Point nasDir at the specific subtree an app owns, not the whole mount.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LIMITATIONS (read before trusting the numbers precisely)
 * ─────────────────────────────────────────────────────────────────────────────
 *   - bytesOut is summed from response Content-Length. Streamed/chunked responses
 *     without that header are undercounted (the request is still counted). Request
 *     COUNT and rate are exact; byte totals are a good-enough gauge, not an audit.
 *   - In-process nas counters + recentWrites only see writes routed through
 *     recordWrite. A raw fs.writeFile you didn't instrument, or an external
 *     process, won't appear there — that's exactly what the opt-in snapshot is
 *     for. If an app shells out to a binary that writes to the NAS, enable nasDir
 *     and rely on the snapshot, not writeOps.
 *   - Counters reset on restart (see WHY, above) — intended, not a bug.
 *   - The snapshot samples state at scan time; a burst finishing between scans is
 *     visible only via totalBytes growth, not as individual recentlyModified rows.
 */

import fsp  from 'node:fs/promises';
import path from 'node:path';

// ── Live counters (one tracker per process) ───────────────────────────────────
//
// A single module-level record. Both the request middleware and the file-store
// write hook feed the same counters, so a per-instance object would split the
// tally; a process is one app is one tracker. Always present (zeroed) so
// computeActivity works even if installActivityTracker was never called.

const state = {
    startedAt:     Date.now(),
    name:          undefined,
    root:          undefined,
    nasDir:        null,
    snapshotOpts:  {},
    network:       { requests: 0, bytesIn: 0, bytesOut: 0 },
    // _recent: bounded ring of { path, bytes, at } — recent writes seen in-process
    nas:           { writeOps: 0, deleteOps: 0, bytesWritten: 0, _recent: [] },
    _snapCache:    null,   // { at: number, data: object }
    _snapInflight: null,   // Promise<object|null> | null
};

// How many recent in-process writes to keep. This is a passive ring fed by
// recordWrite — no filesystem work — so it stays cheap regardless of write rate.
const RECENT_WRITES_MAX = 50;

const SNAPSHOT_DEFAULTS = {
    cacheMs:         30_000,
    recentWindowSec: 120,
    maxRecent:       25,
    maxDepth:        6,
    maxEntries:      20_000,
};

/**
 * Register this process's watch config and reset the count-from timestamp.
 * Call once at boot. Safe to call again to reconfigure (also re-zeros the
 * start time, which resets computed rates on the next poll).
 * @param {object} [options]
 * @param {string} [options.name]
 * @param {string} [options.root]   - defaults to process.cwd()
 * @param {string} [options.nasDir] - directory to snapshot; omit to skip
 * @param {object} [options.snapshot] - snapshot tuning (see SNAPSHOT_DEFAULTS)
 */
export function installActivityTracker(options = {}) {
    state.startedAt    = Date.now();
    state.name         = options.name ?? state.name;
    state.root         = options.root ?? process.cwd();
    state.nasDir       = options.nasDir ?? null;
    state.snapshotOpts = { ...SNAPSHOT_DEFAULTS, ...(options.snapshot ?? {}) };
    state._snapCache   = null;
    state._snapInflight = null;
}

function toByteLength(x) {
    if (typeof x === 'number') return Number.isFinite(x) && x > 0 ? x : 0;
    if (typeof x === 'string') return Buffer.byteLength(x);
    if (x && typeof x.byteLength === 'number') return x.byteLength; // Buffer / TypedArray
    return 0;
}

function parseContentLength(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Tally one NAS write. Passive: increments in-memory counters and appends to a
 * bounded recent-writes ring — no filesystem work. Accepts a byte count, or the
 * content itself (Buffer/string) and measures it, so it drops straight into
 * file-store.js's onWrite hook (which passes content + relPath). Pass the path
 * as the 2nd arg when you have it so the recent-writes list is useful.
 * @param {number|string|Buffer} bytesOrContent
 * @param {string} [relPath] - path written, for the recent-writes list
 */
export function recordWrite(bytesOrContent, relPath) {
    const bytes = toByteLength(bytesOrContent);
    state.nas.writeOps += 1;
    state.nas.bytesWritten += bytes;
    state.nas._recent.push({ path: relPath ?? null, bytes, at: Date.now() });
    if (state.nas._recent.length > RECENT_WRITES_MAX) state.nas._recent.shift();
}

/** Tally one NAS delete. */
export function recordDelete() {
    state.nas.deleteOps += 1;
}

/**
 * Tally one inbound request. Two call shapes:
 *   recordRequest(bytesIn, bytesOut)          — raw numbers
 *   recordRequest(fetchRequest, fetchResponse) — reads Content-Length off both
 * The second is for a SvelteKit `handle` hook; the Express path uses the
 * middleware instead.
 */
export function recordRequest(a, b) {
    state.network.requests += 1;
    if (typeof a === 'number' || typeof b === 'number') {
        state.network.bytesIn  += parseContentLength(a);
        state.network.bytesOut += parseContentLength(b);
        return;
    }
    // Fetch Request / Response pair.
    const inLen  = a?.headers?.get?.('content-length');
    const outLen = b?.headers?.get?.('content-length');
    state.network.bytesIn  += parseContentLength(inLen);
    state.network.bytesOut += parseContentLength(outLen);
}

/**
 * Build an Express middleware that counts inbound requests and their
 * Content-Length bytes. Requests whose path starts with `/activity` are skipped
 * so the endpoint (and the dashboard polling it) don't inflate the very numbers
 * they report. Register before your routes.
 * @returns {(req, res, next) => void}
 */
export function createActivityMiddleware() {
    return function activityMiddleware(req, res, next) {
        const p = req.path || req.url || '';
        if (p.startsWith('/activity')) return next();

        state.network.requests += 1;
        state.network.bytesIn += parseContentLength(req.headers?.['content-length']);
        // Response length isn't known until the response is sent.
        res.on('finish', () => {
            state.network.bytesOut += parseContentLength(res.getHeader?.('content-length'));
        });
        next();
    };
}

// ── NAS filesystem snapshot ───────────────────────────────────────────────────

/**
 * Walk `dir` breadth-limited, returning size/count totals and the files modified
 * within recentWindowSec. Bounded by maxDepth and maxEntries so a huge share
 * can't turn one poll into a full-tree crawl; sets `truncated` when a bound is
 * hit. Symlinks are not followed (avoids escaping the watch subtree and cycles).
 */
async function scanNasDir(dir, opts) {
    const { recentWindowSec, maxRecent, maxDepth, maxEntries } = opts;
    const nowMs = Date.now();
    const recentCutoff = nowMs - recentWindowSec * 1000;

    let totalBytes = 0;
    let fileCount  = 0;
    let entries    = 0;
    let truncated  = false;
    const recent   = []; // { path, mtimeMs, size }

    // Iterative BFS with an explicit queue — recursion depth on a deep share
    // could otherwise blow the stack, and a queue makes the maxEntries cap a
    // clean early-out.
    const queue = [{ abs: dir, rel: '', depth: 0 }];
    while (queue.length) {
        const { abs, rel, depth } = queue.shift();
        let dirents;
        try {
            dirents = await fsp.readdir(abs, { withFileTypes: true });
        } catch {
            continue; // unreadable dir (perms, vanished mid-scan) — skip, don't fail the whole scan
        }
        for (const d of dirents) {
            if (entries >= maxEntries) { truncated = true; break; }
            entries += 1;
            if (d.isSymbolicLink()) continue;
            const childRel = rel ? `${rel}/${d.name}` : d.name;
            if (d.isDirectory()) {
                if (depth + 1 <= maxDepth) queue.push({ abs: path.join(abs, d.name), rel: childRel, depth: depth + 1 });
                else truncated = true;
                continue;
            }
            if (!d.isFile()) continue;
            let st;
            try {
                st = await fsp.stat(path.join(abs, d.name));
            } catch {
                continue;
            }
            fileCount  += 1;
            totalBytes += st.size;
            if (st.mtimeMs >= recentCutoff) {
                recent.push({ path: childRel, mtimeMs: st.mtimeMs, size: st.size });
            }
        }
        if (entries >= maxEntries) { truncated = true; break; }
    }

    recent.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const trimmed = recent.slice(0, maxRecent);
    const recentBytes = recent.reduce((sum, r) => sum + r.size, 0);

    return {
        scannedAt:       new Date(nowMs).toISOString(),
        totalBytes,
        fileCount,
        recentWindowSec,
        recentBytes,
        recentlyModified: trimmed.map((r) => ({
            path:  r.path,
            mtime: new Date(r.mtimeMs).toISOString(),
            size:  r.size,
        })),
        truncated,
    };
}

/**
 * Cached snapshot: at most one walk per cacheMs window, with concurrent misses
 * sharing a single in-flight walk (mirrors process-mgr's own fleet-cache
 * pattern). Returns null when scanning fails outright.
 */
async function getNasSnapshot(dir, opts) {
    const now = Date.now();
    if (state._snapCache && now - state._snapCache.at < opts.cacheMs) {
        return state._snapCache.data;
    }
    if (state._snapInflight) return state._snapInflight;

    state._snapInflight = scanNasDir(dir, opts)
        .then((data) => {
            state._snapCache = { at: Date.now(), data };
            return data;
        })
        .catch(() => null)
        .finally(() => { state._snapInflight = null; });
    return state._snapInflight;
}

// ── Report assembly ───────────────────────────────────────────────────────────

/**
 * Assemble the /activity report from the live counters, attaching a cached NAS
 * snapshot when a watch dir is configured. Per-call options override the config
 * installed via installActivityTracker.
 * @param {object} [options] - { name?, root?, nasDir?, snapshot? }
 * @returns {Promise<object>}
 */
export async function computeActivity(options = {}) {
    const root   = options.root ?? state.root ?? process.cwd();
    const nasDir = options.nasDir ?? state.nasDir;
    const snapshotOpts = { ...SNAPSHOT_DEFAULTS, ...state.snapshotOpts, ...(options.snapshot ?? {}) };

    // The filesystem snapshot is the ONLY part of this file that touches the
    // disk, and it is strictly opt-in (nasDir must be set). Apps whose writes all
    // go through recordWrite don't need it — their in-process counters and the
    // recentWrites ring below already tell the story, with zero added NAS load.
    // Turn nasDir on only to catch writers this process can't see (external
    // binaries like yt-dlp), and prefer pointing it at an app's own subtree.
    let snapshot = null;
    if (nasDir) snapshot = await getNasSnapshot(nasDir, snapshotOpts);

    // Passive recent-writes list, newest first, from the in-process ring — no
    // filesystem walk. Same { path, mtime, size } shape as snapshot rows so
    // consumers can treat the two uniformly.
    const recentWrites = state.nas._recent
        .slice()
        .reverse()
        .map((w) => ({ path: w.path, mtime: new Date(w.at).toISOString(), size: w.bytes }));

    const now = Date.now();
    return {
        generatedAt: new Date(now).toISOString(),
        root,
        startedAt:   new Date(state.startedAt).toISOString(),
        uptimeSec:   Math.max(0, Math.round((now - state.startedAt) / 1000)),
        network: {
            requests: state.network.requests,
            bytesIn:  state.network.bytesIn,
            bytesOut: state.network.bytesOut,
        },
        nas: {
            dir:          nasDir ?? null,
            writeOps:     state.nas.writeOps,
            deleteOps:    state.nas.deleteOps,
            bytesWritten: state.nas.bytesWritten,
            recentWrites,
            snapshot,
        },
    };
}

// ── Endpoint factories ────────────────────────────────────────────────────────

/**
 * Express handler for GET /activity.
 * @param {object} [options] - Same as computeActivity, plus `name`.
 * @returns {(req, res) => void}
 */
export function createActivityRoute(options = {}) {
    const { name = state.name } = options;
    return async function activityHandler(req, res) {
        try {
            const report = await computeActivity(options);
            res.json(name ? { name, ...report } : report);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    };
}

/**
 * Fetch-API handler for GET /activity (SvelteKit `+server.js` GET, Next.js route
 * handlers, Hono, Deno, Workers).
 * @param {object} [options] - Same as createActivityRoute.
 * @returns {() => Promise<Response>}
 */
export function createActivityHandler(options = {}) {
    const { name = state.name } = options;
    return async function activityRequestHandler() {
        try {
            const report = await computeActivity(options);
            const payload = name ? { name, ...report } : report;
            return new Response(JSON.stringify(payload), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500, headers: { 'content-type': 'application/json' },
            });
        }
    };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
//
// Single-series line marks only (no categorical palette to validate): the two
// measures — request rate and NAS write rate — are on different scales, so per
// the no-dual-axis rule they render as two separate small-multiple sparklines,
// each in the design's accent hue. Threshold breaches use the reserved status
// colors (amber/red), which is what status colors are for.

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Exported so process-mgr's fleet page can reuse the identical look without
// duplicating the CSS. A single server copying this file for its own
// /activity + /activity/dashboard can ignore this export.
export const ACTIVITY_DASHBOARD_STYLE = `
:root {
  --act-page: #f9f9f7;
  --act-surface: #fcfcfb;
  --act-text: #0b0b0b;
  --act-text-2: #52514e;
  --act-muted: #898781;
  --act-grid: #e1e0d9;
  --act-border: rgba(11,11,11,0.10);
  --act-accent: #2a78d6;
  --act-warn: #c98a2b;
  --act-alert: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --act-page: #0d0d0d;
    --act-surface: #1a1a19;
    --act-text: #ffffff;
    --act-text-2: #c3c2b7;
    --act-muted: #898781;
    --act-grid: #2c2c2a;
    --act-border: rgba(255,255,255,0.10);
    --act-accent: #3987e5;
    --act-warn: #d9a441;
    --act-alert: #e66767;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--act-page); color: var(--act-text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.act-page { max-width: 900px; margin: 0 auto; padding: 32px 20px 64px; }
.act-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.act-header h1 { font-size: 20px; margin: 0; }
.act-sub { margin: 2px 0 0; color: var(--act-text-2); font-size: 13px; }
.act-header-meta { display: flex; align-items: center; gap: 12px; }
.act-status { color: var(--act-muted); font-size: 12px; }
.act-btn { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--act-border); background: var(--act-surface); color: var(--act-text); cursor: pointer; }
.act-btn:hover { border-color: var(--act-muted); }
.act-card { background: var(--act-surface); border: 1px solid var(--act-border); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
.act-card-title { font-size: 14px; font-weight: 600; margin: 0 0 4px; }
.act-card-sub { color: var(--act-muted); font-size: 12px; margin: 0 0 12px; }
.act-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.act-kpi { background: var(--act-surface); border: 1px solid var(--act-border); border-radius: 10px; padding: 14px 16px; }
.act-kpi-value { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.act-kpi-value.is-warn { color: var(--act-warn); }
.act-kpi-value.is-alert { color: var(--act-alert); }
.act-kpi-label { color: var(--act-text-2); font-size: 12px; margin-top: 2px; }
.act-spark-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 640px) { .act-spark-wrap { grid-template-columns: 1fr; } }
.act-spark svg { width: 100%; height: 64px; display: block; }
.act-spark-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.act-spark-cur { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.act-line { fill: none; stroke: var(--act-accent); stroke-width: 2; }
.act-area { fill: var(--act-accent); opacity: 0.10; stroke: none; }
.act-recent-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.act-recent-table th, .act-recent-table td { padding: 5px 10px; border-bottom: 1px solid var(--act-grid); text-align: right; white-space: nowrap; }
.act-recent-table th.act-name, .act-recent-table td.act-name { text-align: left; font-family: ui-monospace, "Cascadia Code", monospace; overflow: hidden; text-overflow: ellipsis; max-width: 380px; }
.act-recent-table th { color: var(--act-text-2); font-weight: 600; }
.act-recent-empty { color: var(--act-muted); font-size: 12px; padding: 8px 0; }
.act-loading, .act-error { text-align: center; color: var(--act-text-2); padding: 48px 16px; }
.act-error { color: var(--act-alert); }
.act-footer { text-align: center; color: var(--act-muted); font-size: 12px; margin-top: 24px; }
`;

const DASHBOARD_SCRIPT = `
var ACT_DATA_URL = '__DATA_URL__';
var ACT_POLL_MS = 4000;
var ACT_MAX = 90;               // ~6 min of history at the poll cadence
var samples = { req: [], nas: [] };
var prev = null;

function fmtInt(n) { return Number(n || 0).toLocaleString('en-US'); }
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
}
function fmtRate(n, unit) {
  n = Number(n) || 0;
  return (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10) + ' ' + unit;
}

// A single-series sparkline: 2px accent line over a faint area fill, baseline at
// the series min so a flat non-zero rate still reads as flat. Pure geometry, no
// axes — the current value is shown as text beside it.
function sparkPath(vals, w, h) {
  if (!vals.length) return { line: '', area: '' };
  var max = Math.max.apply(null, vals);
  var min = Math.min.apply(null, vals);
  var span = max - min || 1;
  var n = vals.length;
  var dx = n > 1 ? w / (n - 1) : 0;
  var pts = vals.map(function (v, i) {
    var x = i * dx;
    var y = h - 2 - ((v - min) / span) * (h - 4);
    return [x, y];
  });
  var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  var area = line + ' L' + (n > 1 ? w : 0).toFixed(1) + ' ' + h + ' L0 ' + h + ' Z';
  return { line: line, area: area };
}

function drawSpark(id, vals) {
  var el = document.getElementById(id);
  if (!el) return;
  var w = el.clientWidth || 300, h = 64;
  var p = sparkPath(vals, w, h);
  el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
    + '<path class="act-area" d="' + p.area + '"></path>'
    + '<path class="act-line" d="' + p.line + '"></path></svg>';
}

function render(data) {
  document.getElementById('act-loading').hidden = true;
  document.getElementById('act-error').hidden = true;
  document.getElementById('act-content').hidden = false;

  var net = data.network || {};
  var nas = data.nas || {};
  document.getElementById('act-req-total').textContent = fmtInt(net.requests);
  document.getElementById('act-out-total').textContent = fmtBytes(net.bytesOut);
  document.getElementById('act-write-total').textContent = fmtInt(nas.writeOps);
  document.getElementById('act-written-total').textContent = fmtBytes(nas.bytesWritten);

  var nowMs = Date.now();
  if (prev) {
    var dt = (nowMs - prev.t) / 1000;
    if (dt > 0) {
      var reqRate = ((net.requests - prev.requests) / dt) * 60;       // per minute
      var nasRate = (nas.bytesWritten - prev.bytesWritten) / dt;      // bytes per second
      samples.req.push(Math.max(0, reqRate));
      samples.nas.push(Math.max(0, nasRate));
      if (samples.req.length > ACT_MAX) samples.req.shift();
      if (samples.nas.length > ACT_MAX) samples.nas.shift();
      document.getElementById('act-req-cur').textContent = fmtRate(reqRate, 'req/min');
      document.getElementById('act-nas-cur').textContent = fmtRate(nasRate / 1e6, 'MB/s');
      drawSpark('act-req-spark', samples.req);
      drawSpark('act-nas-spark', samples.nas);
    }
  }
  prev = { t: nowMs, requests: net.requests, bytesWritten: nas.bytesWritten };

  renderRecent(nas);
  var statusEl = document.getElementById('act-status');
  statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// Prefer the filesystem snapshot (catches external writers) when present;
// otherwise fall back to the passive in-process recentWrites list. Both share
// the { path, mtime, size } row shape.
function renderRecent(nas) {
  var wrap = document.getElementById('act-recent');
  var snap = nas && nas.snapshot;
  var rows, head;
  if (snap) {
    rows = snap.recentlyModified || [];
    head = '<p class="act-card-sub">' + fmtInt(snap.fileCount) + ' files · ' + fmtBytes(snap.totalBytes)
      + (snap.truncated ? ' · partial scan' : '') + ' · in ' + snap.dir + '</p>';
    if (!rows.length) { wrap.innerHTML = head + '<div class="act-recent-empty">Nothing written in the last ' + snap.recentWindowSec + 's.</div>'; return; }
  } else {
    rows = (nas && nas.recentWrites) || [];
    head = '<p class="act-card-sub">Recent in-process writes (' + fmtInt(nas ? nas.writeOps : 0) + ' total since start)</p>';
    if (!rows.length) { wrap.innerHTML = head + '<div class="act-recent-empty">No writes recorded yet.</div>'; return; }
  }
  var body = rows.map(function (r) {
    return '<tr><td class="act-name" title="' + (r.path || '') + '">' + (r.path || '(unnamed)') + '</td><td>' + fmtBytes(r.size)
      + '</td><td>' + new Date(r.mtime).toLocaleTimeString() + '</td></tr>';
  }).join('');
  wrap.innerHTML = head + '<table class="act-recent-table"><thead><tr>'
    + '<th class="act-name">Recently written</th><th>Size</th><th>When</th></tr></thead><tbody>'
    + body + '</tbody></table>';
}

function showError(msg) {
  document.getElementById('act-loading').hidden = true;
  document.getElementById('act-content').hidden = true;
  var e = document.getElementById('act-error');
  e.hidden = false;
  e.textContent = msg;
}

function load() {
  fetch(ACT_DATA_URL, { headers: { accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(function (err) { if (!prev) showError('Failed to load activity: ' + err.message); });
}

document.getElementById('act-refresh').addEventListener('click', load);
load();
setInterval(load, ACT_POLL_MS);
`;

function renderDashboardHtml(name, dataUrl) {
    const safeName = escapeHtml(name);
    const safeDataUrl = escapeHtml(dataUrl);
    const script = DASHBOARD_SCRIPT.replace('__DATA_URL__', dataUrl.replace(/'/g, "\\'"));

    return '<!doctype html>\n'
        + '<html lang="en">\n<head>\n'
        + '<meta charset="utf-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        + '<title>Activity — ' + safeName + '</title>\n'
        + '<style>' + ACTIVITY_DASHBOARD_STYLE + '</style>\n'
        + '</head>\n<body>\n'
        + '<div class="act-page">\n'
        + '  <header class="act-header">\n'
        + '    <div>\n'
        + '      <h1>' + safeName + '</h1>\n'
        + '      <p class="act-sub">Activity dashboard — network & NAS writes</p>\n'
        + '    </div>\n'
        + '    <div class="act-header-meta">\n'
        + '      <span id="act-status" class="act-status">Loading…</span>\n'
        + '      <button id="act-refresh" class="act-btn" type="button">Refresh</button>\n'
        + '    </div>\n'
        + '  </header>\n'
        + '  <main aria-live="polite">\n'
        + '    <div id="act-loading" class="act-loading">Loading activity…</div>\n'
        + '    <div id="act-error" class="act-error" hidden></div>\n'
        + '    <div id="act-content" hidden>\n'
        + '      <section class="act-kpis">\n'
        + '        <div class="act-kpi"><div class="act-kpi-value" id="act-req-total">—</div><div class="act-kpi-label">requests since start</div></div>\n'
        + '        <div class="act-kpi"><div class="act-kpi-value" id="act-out-total">—</div><div class="act-kpi-label">response bytes out</div></div>\n'
        + '        <div class="act-kpi"><div class="act-kpi-value" id="act-write-total">—</div><div class="act-kpi-label">NAS writes (in-process)</div></div>\n'
        + '        <div class="act-kpi"><div class="act-kpi-value" id="act-written-total">—</div><div class="act-kpi-label">NAS bytes written</div></div>\n'
        + '      </section>\n'
        + '      <section class="act-card">\n'
        + '        <div class="act-spark-wrap">\n'
        + '          <div class="act-spark">\n'
        + '            <div class="act-spark-head"><span class="act-card-title">Request rate</span><span class="act-spark-cur" id="act-req-cur">—</span></div>\n'
        + '            <div id="act-req-spark"></div>\n'
        + '          </div>\n'
        + '          <div class="act-spark">\n'
        + '            <div class="act-spark-head"><span class="act-card-title">NAS write rate</span><span class="act-spark-cur" id="act-nas-cur">—</span></div>\n'
        + '            <div id="act-nas-spark"></div>\n'
        + '          </div>\n'
        + '        </div>\n'
        + '      </section>\n'
        + '      <section class="act-card">\n'
        + '        <h2 class="act-card-title">NAS folder</h2>\n'
        + '        <div id="act-recent"></div>\n'
        + '      </section>\n'
        + '    </div>\n'
        + '  </main>\n'
        + '  <footer class="act-footer">Served by activity.js · data from GET ' + safeDataUrl + '</footer>\n'
        + '</div>\n'
        + '<script>' + script + '</script>\n'
        + '</body>\n</html>\n';
}

/**
 * Express handler serving the optional /activity/dashboard page.
 * @param {object} [options]
 * @param {string} [options.name='app']
 * @param {string} [options.dataUrl='/activity']
 * @returns {(req, res) => void}
 */
export function createActivityDashboardRoute(options = {}) {
    const { name = 'app', dataUrl = '/activity' } = options;
    const html = renderDashboardHtml(name, dataUrl);
    return function activityDashboardHandler(req, res) {
        res.type('html').send(html);
    };
}

/**
 * Fetch-API handler serving the optional /activity/dashboard page.
 * @param {object} [options] - Same as createActivityDashboardRoute.
 * @returns {() => Response}
 */
export function createActivityDashboardHandler(options = {}) {
    const { name = 'app', dataUrl = '/activity' } = options;
    const html = renderDashboardHtml(name, dataUrl);
    return function activityDashboardRequestHandler() {
        return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
}
