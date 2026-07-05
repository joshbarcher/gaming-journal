/**
 * @fileoverview Zero-dependency SLOC (source lines of code) counter for Node.js
 * ESM apps, plus the shared `/sloc` endpoint contract for the process-mgr fleet.
 * Ships two adapter pairs so the same core works under Express or SvelteKit
 * (or anything else built on the standard Fetch API) — pick the pair that
 * matches your server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SETUP
 * ─────────────────────────────────────────────────────────────────────────────
 * Copy this file into the project root, then wire up the required endpoint —
 * and, optionally, a matching human-readable dashboard at the shared path.
 *
 * Express:
 *   import { createSlocRoute, createSlocDashboardRoute } from './sloc.js'
 *   app.get('/sloc', createSlocRoute(process.cwd(), { name: 'my-app' }))
 *   app.get('/sloc/dashboard', createSlocDashboardRoute({ name: 'my-app' }))
 *
 * SvelteKit (one `+server.js` file per route — adjust the relative import
 * depth to wherever you copied sloc.js, typically the project root):
 *   // src/routes/sloc/+server.js
 *   import { createSlocHandler } from '../../../sloc.js'
 *   export const GET = createSlocHandler(process.cwd(), { name: 'my-app' })
 *
 *   // src/routes/sloc/dashboard/+server.js
 *   import { createSlocDashboardHandler } from '../../../../sloc.js'
 *   export const GET = createSlocDashboardHandler({ name: 'my-app' })
 *
 * SvelteKit serves a `+server.js` `GET` export as a raw HTTP response — it
 * doesn't need to be JSON, so the dashboard's HTML page works there exactly
 * like the JSON endpoint does, both bypassing Svelte's component pipeline for
 * those two routes only. process.cwd() is SvelteKit's server-side working
 * directory (same as any Node process) — no SvelteKit-specific path handling
 * needed.
 *
 * Requires Node.js 18+. No npm install needed.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE WIRING THIS UP — CHECK FOR ROUTE COLLISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * An agent (or human) adapting this file into an existing server should check
 * the target app's routes BEFORE adding `/sloc` and `/sloc/dashboard` — silently
 * shadowing an existing route, or being silently shadowed by one, is a worse
 * outcome than the wiring simply failing loudly.
 *
 *   1. Search the target app's route definitions for an existing '/sloc' or
 *      '/sloc/dashboard' path (grep the router/entry file for "sloc" and for
 *      any wildcard registrations). If either is already taken by unrelated
 *      functionality, mount these at a different path instead and pass the
 *      matching `dataUrl` to createSlocDashboardRoute/Handler so the
 *      dashboard still fetches the right place.
 *   2. Check registration ORDER, not just presence. In Express, a catch-all
 *      registered before these routes (app.use('*', ...), a SPA fallback, an
 *      early 404 handler) intercepts the request first — mount `/sloc` above
 *      any such catch-all, not below it.
 *   3. In SvelteKit, check for a competing dynamic segment that could also
 *      match — a `src/routes/[...catchall]/+server.js` or
 *      `src/routes/[slug]/+server.js` sitting over `src/routes/sloc/` in the
 *      route tree can absorb the request. SvelteKit prefers the most specific
 *      match, but confirm there isn't already a route or param named `sloc`
 *      doing something unrelated.
 *   4. If the app has its own existing convention (e.g. everything already
 *      lives under an `/api/...` prefix, the way `/health` does elsewhere),
 *      mount `/sloc` under that same prefix rather than introducing a bare
 *      top-level path — matching the app's own convention matters more than
 *      matching this file's example paths literally. Update `dataUrl` and any
 *      fleet-aggregator config (e.g. process-mgr's data/apps.config.json)
 *      to match.
 *
 * None of this is enforced by the code — createSlocRoute/createSlocHandler
 * don't know or care what path they're mounted at. It's a review step for
 * whoever does the wiring, because the failure mode (two handlers on one
 * path, or one silently shadowing the other) doesn't throw; it just serves
 * the wrong thing until someone notices.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REQUIRED /sloc ENDPOINT
 * ─────────────────────────────────────────────────────────────────────────────
 * process-mgr polls every registered app's own /health today (see logger.js's
 * sibling, health.service.js). /sloc follows the exact same shape: each app is
 * responsible for measuring and reporting its own codebase size, and process-mgr
 * aggregates across the fleet by fetching http://localhost:{port}/sloc for every
 * app in data/apps.config.json. Keeping the measurement local to each app (rather
 * than process-mgr walking every app's directory itself) means the endpoint works
 * identically whether process-mgr and the app share a filesystem or not.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIRED RESPONSE SHAPE
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /sloc must return 200 with this JSON shape (createSlocRoute produces this
 * automatically):
 *
 *   {
 *     "name": "my-app",                 // optional, recommended — self-identifies
 *     "generatedAt": "2026-07-03T12:00:00.000Z",
 *     "totals":     { "files": 42, "lines": 5230, "code": 4100, "comment": 380, "blank": 750 },
 *     "byExtension": {
 *       ".js":   { "files": 30, "lines": 4200, "code": 3400, "comment": 300, "blank": 500 },
 *       ".json": { "files": 5,  "lines": 400,  "code": 400,  "comment": 0,   "blank": 0 }
 *     },
 *     "byFolder": {
 *       "src":          { "files": 10, "lines": 1200, "code": 1000, "comment": 100, "blank": 100 },
 *       "src/services": { "files": 8,  "lines": 900,  "code": 750,  "comment": 80,  "blank": 70 }
 *     }
 *   }
 *
 * `byFolder` rolls up: a folder's counts include every file in its subfolders
 * (like `du`), so "src" already contains "src/services". Root-level loose files
 * (not inside any folder) are grouped under the key ".".
 *
 * Pass `?detail=true` to also include a `files` array of per-file stats
 * (`{ path, ext, lines, code, comment, blank }`). This is opt-in because it can
 * be large and defeats the built-in cache (see CACHING below) — process-mgr's
 * fleet-wide aggregator never requests it.
 *
 * A consuming app that can't use this script (non-Node stack) just needs to
 * return JSON matching this shape from its own /sloc route — the format is the
 * contract, not the implementation.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FUNCTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *   computeSloc(rootDir, options?)
 *     Walks rootDir and returns the report shape above (minus "name", which is
 *     only added by createSlocRoute). Returns a fresh result every call — does
 *     not cache.
 *
 *   createSlocRoute(rootDir, options?)
 *     Returns an Express handler `(req, res) => void` implementing the required
 *     endpoint, including the response cache described below.
 *
 *   createSlocHandler(rootDir, options?)
 *     SvelteKit / Fetch-API equivalent of createSlocRoute. Returns
 *     `(event: { url: URL }) => Promise<Response>` — assign it directly to a
 *     `+server.js` route's `GET` export. Same cache, same response shape.
 *
 *   createSlocDashboardRoute(options?)
 *     Returns an Express handler `(req, res) => void` serving a self-contained
 *     HTML dashboard (inline CSS/JS, no build step, no CDN) that fetches the
 *     JSON from `options.dataUrl` client-side and renders it: a headline total,
 *     a code/comment/blank composition bar, and ranked bar lists by extension
 *     and by folder, each with a table-view toggle. See DASHBOARD below.
 *
 *   createSlocDashboardHandler(options?)
 *     SvelteKit / Fetch-API equivalent of createSlocDashboardRoute. Returns
 *     `() => Response` serving the identical HTML page — assign it to a
 *     `+server.js` route's `GET` export.
 *
 *   classifyLines(content, commentSyntax?)
 *     Pure function: classifies the lines of a single file's content into
 *     { lines, code, comment, blank }. Exported for unit testing and for apps
 *     that want custom file-selection logic on top of the same classifier.
 *
 * options (both computeSloc and createSlocRoute accept these):
 *   ignoreDirs   string[]  Directory names to skip entirely. Default: DEFAULT_IGNORE_DIRS.
 *   ignoreFiles  string[]  File basenames to skip. Default: DEFAULT_IGNORE_FILES.
 *   extensions   string[]  Allowlist of extensions to count. Default: DEFAULT_EXTENSIONS.
 *   detail       boolean   Include a per-file `files` array. Default: false.
 *
 * createSlocRoute / createSlocHandler-only options:
 *   name     string  Included as "name" in every response. Recommended so
 *                     process-mgr's fleet aggregator doesn't have to guess.
 *   cacheMs  number  How long to reuse the last non-detail report before
 *                     re-walking the directory. Default: 30000 (30s). Set to 0
 *                     to disable caching. Requests with ?detail=true always
 *                     bypass the cache and compute fresh.
 *
 * createSlocDashboardRoute / createSlocDashboardHandler-only options:
 *   name     string  Shown in the page title/header. Default: 'app'.
 *   dataUrl  string  Where the page's client-side JS fetches JSON from.
 *                     Default: '/sloc' — only change this if you mounted the
 *                     JSON endpoint somewhere nonstandard.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DASHBOARD
 * ─────────────────────────────────────────────────────────────────────────────
 * `/sloc` (the JSON endpoint) is the required contract — process-mgr's fleet
 * aggregator depends on it. `/sloc/dashboard` is optional but recommended: a
 * uniform human-readable view so every server in the fleet looks the same when
 * someone actually opens it in a browser. Both are one-liners off this file,
 * Express or SvelteKit (see SETUP above for the SvelteKit `+server.js` form):
 *
 *   app.get('/sloc', createSlocRoute(process.cwd(), { name: 'my-app' }))
 *   app.get('/sloc/dashboard', createSlocDashboardRoute({ name: 'my-app' }))
 *
 * The dashboard route itself does no filesystem work and has no cache of its
 * own — it serves one precomputed HTML string. All the data comes from the
 * page's client-side JS fetching `options.dataUrl` (default `/sloc`) in the
 * browser after load, exactly like any other consumer of that endpoint, so it
 * automatically gets whatever cache the `/sloc` route/handler you wired up
 * separately is running (30s by default). This works identically whether
 * `/sloc` and `/sloc/dashboard` are both Express, both SvelteKit, or one of
 * each — the dashboard only needs to know the URL, not the framework behind it.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CUSTOMIZING IGNORES
 * ─────────────────────────────────────────────────────────────────────────────
 * DEFAULT_IGNORE_DIRS covers common generated/vendored directories (node_modules,
 * .git, dist, build, coverage, etc.) but NOT app-specific storage directories.
 * If your server keeps user data or media inside its working directory (e.g. an
 * uploads/ or cache/ folder that isn't part of the source tree), add it:
 *
 *   createSlocRoute(process.cwd(), {
 *     name: 'photos-server',
 *     ignoreDirs: [...DEFAULT_IGNORE_DIRS, 'uploads', 'thumbnails'],
 *   })
 *
 * DEFAULT_EXTENSIONS is an allowlist, not a denylist — unrecognized extensions
 * (images, fonts, video, lockfiles not already excluded) are skipped by default
 * rather than miscounted as code. Pass `extensions` to widen or narrow it.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LIMITATIONS (read before trusting comment/code numbers precisely)
 * ─────────────────────────────────────────────────────────────────────────────
 * Comment detection is line-based, not a real tokenizer:
 *   - A line is "comment" only if it's a comment in its entirety (starts with
 *     the line-comment marker, or falls fully inside a block comment).
 *   - A line with trailing code AFTER a block comment closes on the same line
 *     (e.g. "*​/ doStuff()") is still counted as "comment" for simplicity — rare
 *     in practice, and this is meant to gauge codebase size, not enforce a style
 *     guide.
 *   - Strings containing comment-like sequences (e.g. a JS string literal
 *     containing "//") are not specially handled and could misclassify a line.
 * This is intentional: a full parser per language isn't worth it for a fleet
 * size dashboard. `totals.lines` (raw line count) is always exact; `code` /
 * `comment` / `blank` are a good-enough breakdown, not a precise audit.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';

// ── Comment syntax table ─────────────────────────────────────────────────────

const C_STYLE = { line: '//', blockOpen: '/*', blockClose: '*/' };
const HASH = { line: '#' };
const HTML_STYLE = { blockOpen: '<!--', blockClose: '-->' };
const SQL_STYLE = { line: '--', blockOpen: '/*', blockClose: '*/' };

// Extension → comment syntax. `undefined` means "no comment concept" (e.g. JSON) —
// every non-blank line in those files counts as code.
export const COMMENT_SYNTAX = {
    '.js': C_STYLE, '.mjs': C_STYLE, '.cjs': C_STYLE, '.jsx': C_STYLE, '.ts': C_STYLE, '.tsx': C_STYLE,
    '.java': C_STYLE, '.c': C_STYLE, '.h': C_STYLE, '.cpp': C_STYLE, '.hpp': C_STYLE, '.cs': C_STYLE,
    '.go': C_STYLE, '.rs': C_STYLE, '.php': C_STYLE, '.swift': C_STYLE, '.kt': C_STYLE,
    '.css': { blockOpen: '/*', blockClose: '*/' }, '.scss': C_STYLE, '.less': C_STYLE,
    '.py': HASH, '.rb': HASH, '.sh': HASH, '.bash': HASH, '.yml': HASH, '.yaml': HASH, '.toml': HASH,
    '.sql': SQL_STYLE,
    '.html': HTML_STYLE, '.htm': HTML_STYLE, '.xml': HTML_STYLE, '.vue': HTML_STYLE, '.svelte': HTML_STYLE,
    '.md': undefined, '.mdx': undefined, '.json': undefined, '.txt': undefined, '.env': undefined,
};

export const DEFAULT_EXTENSIONS = Object.keys(COMMENT_SYNTAX);

export const DEFAULT_IGNORE_DIRS = [
    'node_modules', '.git', '.hg', '.svn',
    'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.turbo', '.cache',
    '.vscode', '.idea', 'tmp', 'vendor', 'logs',
];

export const DEFAULT_IGNORE_FILES = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json',
];

// ── Line classification ──────────────────────────────────────────────────────

function emptyCounts() {
    return { files: 0, lines: 0, code: 0, comment: 0, blank: 0 };
}

function addCounts(target, stats) {
    target.files += 1;
    target.lines += stats.lines;
    target.code += stats.code;
    target.comment += stats.comment;
    target.blank += stats.blank;
    return target;
}

/**
 * Classify the lines of a single file's content.
 * @param {string} content - Full file content.
 * @param {{line?: string, blockOpen?: string, blockClose?: string}} [syntax] - Comment
 *   markers for this file's language. Omit for languages with no comment concept.
 * @returns {{lines: number, code: number, comment: number, blank: number}}
 */
export function classifyLines(content, syntax) {
    const rawLines = content.split('\n');
    // A trailing '' from the file's final newline isn't an authored line.
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

    let code = 0, comment = 0, blank = 0;
    let inBlock = false;

    for (const raw of rawLines) {
        const line = raw.trim();
        if (line === '') { blank++; continue; }

        if (inBlock) {
            comment++;
            if (syntax?.blockClose && line.includes(syntax.blockClose)) inBlock = false;
            continue;
        }

        if (syntax?.line && line.startsWith(syntax.line)) { comment++; continue; }

        if (syntax?.blockOpen && line.startsWith(syntax.blockOpen)) {
            comment++;
            const closeIdx = line.indexOf(syntax.blockClose, syntax.blockOpen.length);
            if (closeIdx === -1) inBlock = true;
            continue;
        }

        code++;
    }

    return { lines: rawLines.length, code, comment, blank };
}

// ── Directory walk ───────────────────────────────────────────────────────────

async function* walk(dir, ignoreDirs, ignoreFiles) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return; // unreadable directory — skip rather than fail the whole report
    }

    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue; // avoid cycles

        if (entry.isDirectory()) {
            if (ignoreDirs.includes(entry.name)) continue;
            yield* walk(join(dir, entry.name), ignoreDirs, ignoreFiles);
        } else if (entry.isFile()) {
            if (ignoreFiles.includes(entry.name)) continue;
            yield join(dir, entry.name);
        }
    }
}

function ancestorFolders(relPath) {
    const parts = relPath.split('/');
    parts.pop(); // drop filename
    if (parts.length === 0) return ['.'];
    const folders = [];
    for (let i = 1; i <= parts.length; i++) folders.push(parts.slice(0, i).join('/'));
    return folders;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Walk rootDir and compute SLOC totals, broken down by extension and by folder.
 * @param {string} rootDir - Absolute path to the project root to scan.
 * @param {object} [options]
 * @param {string[]} [options.ignoreDirs]
 * @param {string[]} [options.ignoreFiles]
 * @param {string[]} [options.extensions]
 * @param {boolean} [options.detail] - Include a per-file `files` array.
 * @returns {Promise<object>} See the required response shape documented above.
 */
export async function computeSloc(rootDir, options = {}) {
    const {
        ignoreDirs = DEFAULT_IGNORE_DIRS,
        ignoreFiles = DEFAULT_IGNORE_FILES,
        extensions = DEFAULT_EXTENSIONS,
        detail = false,
    } = options;

    const totals = emptyCounts();
    const byExtension = {};
    const byFolder = {};
    const files = [];

    for await (const filePath of walk(rootDir, ignoreDirs, ignoreFiles)) {
        const ext = extname(filePath).toLowerCase();
        if (!extensions.includes(ext)) continue;

        let content;
        try {
            content = await readFile(filePath, 'utf-8');
        } catch {
            continue; // permissions / deleted mid-walk — skip rather than fail the report
        }

        const stats = classifyLines(content, COMMENT_SYNTAX[ext]);
        const relPath = relative(rootDir, filePath).split(sep).join('/');

        addCounts(totals, stats);
        addCounts(byExtension[ext] ??= emptyCounts(), stats);
        for (const folder of ancestorFolders(relPath)) {
            addCounts(byFolder[folder] ??= emptyCounts(), stats);
        }

        if (detail) files.push({ path: relPath, ext, ...stats });
    }

    return {
        generatedAt: new Date().toISOString(),
        totals,
        byExtension,
        byFolder,
        ...(detail ? { files } : {}),
    };
}

/**
 * Build an Express handler implementing the required `/sloc` endpoint.
 * @param {string} rootDir - Absolute path to the project root to scan.
 * @param {object} [options] - Same as computeSloc, plus:
 * @param {string} [options.name] - Included as "name" in every response.
 * @param {number} [options.cacheMs=30000] - Reuse the last non-detail report for
 *   this many ms before re-walking. 0 disables caching.
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<void>}
 *
 * @example
 * import { createSlocRoute } from './sloc.js'
 * app.get('/sloc', createSlocRoute(process.cwd(), { name: 'my-app' }))
 */
// Shared cache/compute core behind both the Express and Fetch-API adapters
// below, so `/sloc` behaves identically (same 30s cache) no matter which
// framework wired it up.
function createReportProvider(rootDir, options = {}) {
    const { cacheMs = 30000, name, ...computeOptions } = options;
    let cache = null;
    let cachedAt = 0;

    return async function getReport(detail) {
        const now = Date.now();
        if (!detail && cache && now - cachedAt < cacheMs) return cache;

        const report = await computeSloc(rootDir, { ...computeOptions, detail });
        const payload = name ? { name, ...report } : report;

        if (!detail) { cache = payload; cachedAt = now; }
        return payload;
    };
}

export function createSlocRoute(rootDir, options = {}) {
    const getReport = createReportProvider(rootDir, options);

    return async function slocHandler(req, res) {
        try {
            const detail = req.query?.detail === 'true' || req.query?.detail === '1';
            res.json(await getReport(detail));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    };
}

/**
 * Build a framework-agnostic `/sloc` handler on the standard Fetch API
 * (Request/Response/URL) — the shape SvelteKit `+server.js` routes export as
 * `GET`, and the same shape used by Next.js route handlers, Remix resource
 * routes, Hono, Deno, and Cloudflare Workers.
 * @param {string} rootDir - Absolute path to the project root to scan.
 * @param {object} [options] - Same as createSlocRoute.
 * @returns {(event: { url: URL }) => Promise<Response>}
 *
 * @example
 * // src/routes/sloc/+server.js
 * import { createSlocHandler } from '../../../sloc.js'
 * export const GET = createSlocHandler(process.cwd(), { name: 'my-app' })
 */
export function createSlocHandler(rootDir, options = {}) {
    const getReport = createReportProvider(rootDir, options);

    return async function slocRequestHandler(event) {
        try {
            const detail = event?.url?.searchParams?.get('detail') === 'true'
                || event?.url?.searchParams?.get('detail') === '1';
            const payload = await getReport(detail);
            return new Response(JSON.stringify(payload), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { 'content-type': 'application/json' },
            });
        }
    };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
//
// Colors below are the validated categorical slots 1 (blue) and 2 (aqua) from
// the shared palette, used in their documented fixed order, plus a neutral gray
// for "blank" (not a categorical slot — blank lines aren't an identity worth a
// hue). Checked with the palette's six-checks validator: both PASS in light and
// dark; light-mode aqua carries an expected sub-3:1-contrast WARN against the
// page surface, mitigated by never using it as text color and always shipping
// the table-view toggle (the required "relief" channel).

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const DASHBOARD_STYLE = `
:root {
  --sloc-page: #f9f9f7;
  --sloc-surface: #fcfcfb;
  --sloc-text: #0b0b0b;
  --sloc-text-2: #52514e;
  --sloc-muted: #898781;
  --sloc-grid: #e1e0d9;
  --sloc-border: rgba(11,11,11,0.10);
  --sloc-code: #2a78d6;
  --sloc-comment: #1baf7a;
  --sloc-blank: #c9c8c2;
  --sloc-error: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --sloc-page: #0d0d0d;
    --sloc-surface: #1a1a19;
    --sloc-text: #ffffff;
    --sloc-text-2: #c3c2b7;
    --sloc-muted: #898781;
    --sloc-grid: #2c2c2a;
    --sloc-border: rgba(255,255,255,0.10);
    --sloc-code: #3987e5;
    --sloc-comment: #199e70;
    --sloc-blank: #45443e;
    --sloc-error: #e66767;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--sloc-page);
  color: var(--sloc-text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.sloc-page { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; }
.sloc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.sloc-header h1 { font-size: 20px; margin: 0; }
.sloc-sub { margin: 2px 0 0; color: var(--sloc-text-2); font-size: 13px; }
.sloc-header-meta { display: flex; align-items: center; gap: 12px; }
.sloc-status { color: var(--sloc-muted); font-size: 12px; }
.sloc-btn {
  font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px;
  border: 1px solid var(--sloc-border); background: var(--sloc-surface); color: var(--sloc-text);
  cursor: pointer;
}
.sloc-btn:hover { border-color: var(--sloc-muted); }
.sloc-btn:disabled { opacity: 0.5; cursor: default; }
.sloc-btn--ghost { background: transparent; }

.sloc-card { background: var(--sloc-surface); border: 1px solid var(--sloc-border); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
.sloc-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sloc-card-title { font-size: 14px; font-weight: 600; margin: 0 0 12px; }
.sloc-card-head .sloc-card-title { margin-bottom: 0; }

.sloc-hero { text-align: center; padding: 32px 20px; }
.sloc-hero-value { font-size: 56px; font-weight: 700; line-height: 1.1; }
.sloc-hero-label { color: var(--sloc-text-2); font-size: 14px; margin-top: 4px; }
.sloc-hero-sub { color: var(--sloc-muted); font-size: 13px; margin-top: 2px; }

.sloc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
.sloc-kpi { background: var(--sloc-surface); border: 1px solid var(--sloc-border); border-radius: 10px; padding: 14px 16px; }
.sloc-kpi-value { font-size: 22px; font-weight: 600; }
.sloc-kpi-label { color: var(--sloc-text-2); font-size: 12px; margin-top: 2px; display: flex; align-items: center; gap: 6px; }

.sloc-legend { display: flex; gap: 18px; flex-wrap: wrap; }
.sloc-legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--sloc-text-2); }
.sloc-dot { width: 8px; height: 8px; min-width: 8px; border-radius: 50%; display: inline-block; }
.sloc-dot--code { background: var(--sloc-code); }
.sloc-dot--comment { background: var(--sloc-comment); }
.sloc-dot--blank { background: var(--sloc-blank); }

.sloc-bar-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.sloc-bar-label { flex: 0 0 130px; font-size: 12px; color: var(--sloc-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sloc-bar-track { flex: 1 1 auto; height: 16px; }
.sloc-bar-track--full { height: 22px; display: flex; }
.sloc-bar-fill { display: flex; height: 100%; }
.sloc-seg { display: block; height: 100%; margin-right: 2px; }
.sloc-seg:last-child { margin-right: 0; }
.sloc-seg--code { background: var(--sloc-code); }
.sloc-seg--comment { background: var(--sloc-comment); }
.sloc-seg--blank { background: var(--sloc-blank); }
.sloc-seg--last { border-radius: 0 4px 4px 0; }
.sloc-bar-track--full .sloc-seg--first { border-radius: 4px 0 0 4px; }
.sloc-bar-value { flex: 0 0 56px; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; }
.sloc-bar-more { color: var(--sloc-muted); font-size: 12px; padding: 6px 0 0 140px; }

.sloc-table-wrap { overflow-x: auto; }
.sloc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sloc-table th, .sloc-table td { padding: 6px 10px; border-bottom: 1px solid var(--sloc-grid); text-align: right; white-space: nowrap; }
.sloc-table th.sloc-table-name, .sloc-table td.sloc-table-name { text-align: left; }
.sloc-table td { font-variant-numeric: tabular-nums; }
.sloc-table th { color: var(--sloc-text-2); font-weight: 600; }

.sloc-loading, .sloc-error, .sloc-empty { text-align: center; color: var(--sloc-text-2); padding: 48px 16px; }
.sloc-error { color: var(--sloc-error); }
.sloc-content.is-refreshing { opacity: 0.55; pointer-events: none; transition: opacity 0.15s; }

.sloc-tooltip {
  position: fixed; z-index: 20; background: var(--sloc-text); color: var(--sloc-page);
  font-size: 12px; padding: 5px 8px; border-radius: 6px; pointer-events: none; max-width: 220px;
}
.sloc-footer { text-align: center; color: var(--sloc-muted); font-size: 12px; margin-top: 24px; }
`;

const DASHBOARD_SCRIPT = `
var SLOC_DATA_URL = '__DATA_URL__';

function slocFormatCompact(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString('en-US');
}
function slocPct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
function slocEl(tag, className, text) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

var slocTooltip = document.getElementById('sloc-tooltip');
function slocMoveTooltip(evt) {
  slocTooltip.style.left = (evt.clientX + 14) + 'px';
  slocTooltip.style.top = (evt.clientY + 14) + 'px';
}
function slocBindTooltip(el, text) {
  el.setAttribute('tabindex', '0');
  function show(evt) { slocTooltip.textContent = text; slocTooltip.hidden = false; slocMoveTooltip(evt); }
  function hide() { slocTooltip.hidden = true; }
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', slocMoveTooltip);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('focus', show);
  el.addEventListener('blur', hide);
}

function slocBuildSegments(container, row, total) {
  var parts = [
    { key: 'code', value: row.code, label: 'Code' },
    { key: 'comment', value: row.comment, label: 'Comments' },
    { key: 'blank', value: row.blank, label: 'Blank' }
  ].filter(function (p) { return p.value > 0; });

  parts.forEach(function (p, i) {
    var seg = slocEl('span', 'sloc-seg sloc-seg--' + p.key);
    seg.style.width = (total > 0 ? (p.value / total) * 100 : 0) + '%';
    if (i === 0) seg.classList.add('sloc-seg--first');
    if (i === parts.length - 1) seg.classList.add('sloc-seg--last');
    container.appendChild(seg);
    var pct = slocPct(p.value, total);
    slocBindTooltip(seg, p.label + ': ' + p.value.toLocaleString('en-US') + ' lines (' + pct + '%)');
  });
}

function slocRenderBarList(containerEl, rows) {
  containerEl.innerHTML = '';
  var capped = rows.slice(0, 8);
  var maxLines = capped.length ? capped[0].lines : 0;

  capped.forEach(function (row) {
    var rowEl = slocEl('div', 'sloc-bar-row');

    var labelEl = slocEl('span', 'sloc-bar-label', row.label);
    labelEl.title = row.label;
    rowEl.appendChild(labelEl);

    var trackEl = slocEl('span', 'sloc-bar-track');
    var fillEl = slocEl('span', 'sloc-bar-fill');
    fillEl.style.width = (maxLines > 0 ? (row.lines / maxLines) * 100 : 0) + '%';
    slocBuildSegments(fillEl, row, row.lines);
    trackEl.appendChild(fillEl);
    rowEl.appendChild(trackEl);

    rowEl.appendChild(slocEl('span', 'sloc-bar-value', slocFormatCompact(row.lines)));
    containerEl.appendChild(rowEl);
  });

  if (rows.length > capped.length) {
    containerEl.appendChild(slocEl('div', 'sloc-bar-more', '+' + (rows.length - capped.length) + ' more — see table view'));
  }
}

function slocRenderTable(containerEl, rows, nameHeader) {
  containerEl.innerHTML = '';
  var table = slocEl('table', 'sloc-table');
  var thead = slocEl('thead');
  var headRow = slocEl('tr');
  [nameHeader, 'Files', 'Lines', 'Code', 'Comments', 'Blank'].forEach(function (h, i) {
    headRow.appendChild(slocEl('th', i === 0 ? 'sloc-table-name' : 'sloc-table-num', h));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  var tbody = slocEl('tbody');
  rows.forEach(function (row) {
    var tr = slocEl('tr');
    var nameCell = slocEl('td', 'sloc-table-name', row.label);
    if (row.depth) nameCell.style.paddingLeft = (row.depth * 16 + 10) + 'px';
    tr.appendChild(nameCell);
    [row.files, row.lines, row.code, row.comment, row.blank].forEach(function (v) {
      tr.appendChild(slocEl('td', 'sloc-table-num', v.toLocaleString('en-US')));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  containerEl.appendChild(table);
}

function slocSetupToggle(button, chartEl, tableEl) {
  button.addEventListener('click', function () {
    var showingTable = !tableEl.hidden;
    tableEl.hidden = showingTable;
    chartEl.hidden = !showingTable;
    button.textContent = showingTable ? 'Table view' : 'Chart view';
  });
}

function slocRender(data) {
  var t = data.totals;
  var contentEl = document.getElementById('sloc-content');
  var emptyEl = document.getElementById('sloc-empty');

  if (!t.files) {
    contentEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  contentEl.hidden = false;
  emptyEl.hidden = true;

  document.getElementById('sloc-hero-value').textContent = slocFormatCompact(t.lines);
  document.getElementById('sloc-hero-sub').textContent = 'across ' + t.files.toLocaleString('en-US') + ' files';

  var kpis = document.getElementById('sloc-kpis');
  kpis.innerHTML = '';
  [
    { label: 'Files', value: t.files },
    { label: 'Code', value: t.code, series: 'code' },
    { label: 'Comments', value: t.comment, series: 'comment' },
    { label: 'Blank', value: t.blank, series: 'blank' }
  ].forEach(function (kpi) {
    var tile = slocEl('div', 'sloc-kpi');
    tile.appendChild(slocEl('div', 'sloc-kpi-value', slocFormatCompact(kpi.value)));
    var labelEl = slocEl('div', 'sloc-kpi-label');
    if (kpi.series) labelEl.appendChild(slocEl('span', 'sloc-dot sloc-dot--' + kpi.series));
    labelEl.appendChild(slocEl('span', null, kpi.label + (kpi.series ? ' · ' + slocPct(kpi.value, t.lines) + '%' : '')));
    tile.appendChild(labelEl);
    kpis.appendChild(tile);
  });

  var legend = document.getElementById('sloc-legend');
  legend.innerHTML = '';
  [['code', 'Code', t.code], ['comment', 'Comments', t.comment], ['blank', 'Blank', t.blank]].forEach(function (item) {
    var el = slocEl('span', 'sloc-legend-item');
    el.appendChild(slocEl('span', 'sloc-dot sloc-dot--' + item[0]));
    el.appendChild(slocEl('span', null, item[1] + ' ' + slocFormatCompact(item[2]) + ' (' + slocPct(item[2], t.lines) + '%)'));
    legend.appendChild(el);
  });

  var compositionEl = document.getElementById('sloc-composition');
  compositionEl.innerHTML = '';
  slocBuildSegments(compositionEl, t, t.lines);

  var byExtension = data.byExtension || {};
  var extRows = Object.keys(byExtension).map(function (ext) {
    var v = byExtension[ext];
    return { label: ext, files: v.files, lines: v.lines, code: v.code, comment: v.comment, blank: v.blank };
  }).sort(function (a, b) { return b.lines - a.lines; });
  slocRenderBarList(document.getElementById('sloc-ext-chart'), extRows);
  slocRenderTable(document.getElementById('sloc-ext-table'), extRows, 'Extension');

  var byFolder = data.byFolder || {};
  var topFolderRows = Object.keys(byFolder)
    .filter(function (f) { return f === '.' || f.indexOf('/') === -1; })
    .map(function (f) {
      var v = byFolder[f];
      return { label: f, files: v.files, lines: v.lines, code: v.code, comment: v.comment, blank: v.blank };
    })
    .sort(function (a, b) { return b.lines - a.lines; });
  var allFolderRows = Object.keys(byFolder)
    .map(function (f) {
      var v = byFolder[f];
      return { label: f, depth: f === '.' ? 0 : f.split('/').length - 1, files: v.files, lines: v.lines, code: v.code, comment: v.comment, blank: v.blank };
    })
    .sort(function (a, b) { return a.label.localeCompare(b.label); });
  slocRenderBarList(document.getElementById('sloc-folder-chart'), topFolderRows);
  slocRenderTable(document.getElementById('sloc-folder-table'), allFolderRows, 'Folder');
}

var slocLastData = null;
var slocLoadingEl = document.getElementById('sloc-loading');
var slocErrorEl = document.getElementById('sloc-error');
var slocContentWrapEl = document.getElementById('sloc-content-wrap');
var slocContentEl = document.getElementById('sloc-content');
var slocStatusEl = document.getElementById('sloc-status');
var slocRefreshBtn = document.getElementById('sloc-refresh');

function slocShowError(message) {
  slocLoadingEl.hidden = true;
  slocContentWrapEl.hidden = true;
  slocErrorEl.hidden = false;
  slocErrorEl.textContent = 'Could not load SLOC data: ' + message;
}

function slocLoad(isRefresh) {
  if (isRefresh) {
    slocContentEl.classList.add('is-refreshing');
    slocRefreshBtn.disabled = true;
  }
  fetch(SLOC_DATA_URL, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      slocLastData = data;
      slocLoadingEl.hidden = true;
      slocErrorEl.hidden = true;
      slocContentWrapEl.hidden = false;
      slocRender(data);
      slocStatusEl.textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString();
    })
    .catch(function (err) {
      if (!slocLastData) slocShowError(err.message);
      else slocStatusEl.textContent = 'Refresh failed: ' + err.message;
    })
    .then(function () {
      slocContentEl.classList.remove('is-refreshing');
      slocRefreshBtn.disabled = false;
    });
}

slocRefreshBtn.addEventListener('click', function () { slocLoad(true); });
slocSetupToggle(document.querySelector('[data-toggle="ext"]'), document.getElementById('sloc-ext-chart'), document.getElementById('sloc-ext-table'));
slocSetupToggle(document.querySelector('[data-toggle="folder"]'), document.getElementById('sloc-folder-chart'), document.getElementById('sloc-folder-table'));
slocLoad(false);
`;

function renderDashboardHtml(name, dataUrl) {
    const safeName = escapeHtml(name);
    const safeDataUrl = escapeHtml(dataUrl);
    const script = DASHBOARD_SCRIPT.replace('__DATA_URL__', dataUrl.replace(/'/g, "\\'"));

    return '<!doctype html>\n'
        + '<html lang="en">\n<head>\n'
        + '<meta charset="utf-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        + '<title>SLOC — ' + safeName + '</title>\n'
        + '<style>' + DASHBOARD_STYLE + '</style>\n'
        + '</head>\n<body>\n'
        + '<div class="sloc-page">\n'
        + '  <header class="sloc-header">\n'
        + '    <div>\n'
        + '      <h1>' + safeName + '</h1>\n'
        + '      <p class="sloc-sub">SLOC dashboard</p>\n'
        + '    </div>\n'
        + '    <div class="sloc-header-meta">\n'
        + '      <span id="sloc-status" class="sloc-status">Loading…</span>\n'
        + '      <button id="sloc-refresh" class="sloc-btn" type="button">Refresh</button>\n'
        + '    </div>\n'
        + '  </header>\n'
        + '  <main aria-live="polite">\n'
        + '    <div id="sloc-loading" class="sloc-loading">Loading SLOC report…</div>\n'
        + '    <div id="sloc-error" class="sloc-error" hidden></div>\n'
        + '    <div id="sloc-empty" class="sloc-empty" hidden>No countable source files found.</div>\n'
        + '    <div id="sloc-content-wrap" hidden>\n'
        + '      <div id="sloc-content">\n'
        + '        <section class="sloc-card sloc-hero">\n'
        + '          <div class="sloc-hero-value" id="sloc-hero-value">—</div>\n'
        + '          <div class="sloc-hero-label">lines of code</div>\n'
        + '          <div class="sloc-hero-sub" id="sloc-hero-sub"></div>\n'
        + '        </section>\n'
        + '        <section class="sloc-kpis" id="sloc-kpis"></section>\n'
        + '        <section class="sloc-card">\n'
        + '          <h2 class="sloc-card-title">Composition</h2>\n'
        + '          <span class="sloc-bar-track sloc-bar-track--full" id="sloc-composition"></span>\n'
        + '          <div class="sloc-legend" id="sloc-legend" style="margin-top:12px"></div>\n'
        + '        </section>\n'
        + '        <section class="sloc-card">\n'
        + '          <div class="sloc-card-head">\n'
        + '            <h2 class="sloc-card-title">By extension</h2>\n'
        + '            <button class="sloc-btn sloc-btn--ghost" type="button" data-toggle="ext">Table view</button>\n'
        + '          </div>\n'
        + '          <div id="sloc-ext-chart"></div>\n'
        + '          <div id="sloc-ext-table" class="sloc-table-wrap" hidden></div>\n'
        + '        </section>\n'
        + '        <section class="sloc-card">\n'
        + '          <div class="sloc-card-head">\n'
        + '            <h2 class="sloc-card-title">By folder</h2>\n'
        + '            <button class="sloc-btn sloc-btn--ghost" type="button" data-toggle="folder">Table view</button>\n'
        + '          </div>\n'
        + '          <div id="sloc-folder-chart"></div>\n'
        + '          <div id="sloc-folder-table" class="sloc-table-wrap" hidden></div>\n'
        + '        </section>\n'
        + '      </div>\n'
        + '    </div>\n'
        + '  </main>\n'
        + '  <footer class="sloc-footer">Served by sloc.js · data from GET ' + safeDataUrl + '</footer>\n'
        + '</div>\n'
        + '<div id="sloc-tooltip" class="sloc-tooltip" role="tooltip" hidden></div>\n'
        + '<script>' + script + '</script>\n'
        + '</body>\n</html>\n';
}

/**
 * Build an Express handler serving the optional `/sloc/dashboard` page: a
 * self-contained HTML view (inline CSS/JS, no build step, no CDN) that fetches
 * `options.dataUrl` client-side and renders the same report createSlocRoute
 * returns. Purely presentational — it does not touch the filesystem itself.
 * @param {object} [options]
 * @param {string} [options.name='app'] - Shown in the page title and header.
 * @param {string} [options.dataUrl='/sloc'] - Where the page fetches JSON from.
 * @returns {(req: import('express').Request, res: import('express').Response) => void}
 *
 * @example
 * import { createSlocDashboardRoute } from './sloc.js'
 * app.get('/sloc/dashboard', createSlocDashboardRoute({ name: 'my-app' }))
 */
export function createSlocDashboardRoute(options = {}) {
    const { name = 'app', dataUrl = '/sloc' } = options;
    const html = renderDashboardHtml(name, dataUrl);

    return function slocDashboardHandler(req, res) {
        res.type('html').send(html);
    };
}

/**
 * Build a framework-agnostic `/sloc/dashboard` handler on the standard Fetch
 * API (Request/Response) — the shape SvelteKit `+server.js` routes export as
 * `GET`. SvelteKit serves it as a raw HTML response (bypassing the Svelte
 * render pipeline for that route), which is exactly what a self-contained,
 * pre-built HTML page like this one wants.
 * @param {object} [options] - Same as createSlocDashboardRoute.
 * @returns {() => Response}
 *
 * @example
 * // src/routes/sloc/dashboard/+server.js
 * import { createSlocDashboardHandler } from '../../../../sloc.js'
 * export const GET = createSlocDashboardHandler({ name: 'my-app' })
 */
export function createSlocDashboardHandler(options = {}) {
    const { name = 'app', dataUrl = '/sloc' } = options;
    const html = renderDashboardHtml(name, dataUrl);

    return function slocDashboardRequestHandler() {
        return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
}
