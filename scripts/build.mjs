/**
 * @fileoverview Zero-dependency production build for SvelteKit + adapter-node:
 * builds into a staging directory and atomically swaps it into `build/`,
 * so a currently-running server process is never reading from a `build/`
 * that's mid-rebuild or torn down.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * adapter-node lazily imports each route's server-side chunk on its first
 * request in a given process's lifetime - it doesn't eagerly load every
 * route at startup. That matters because a plain `vite build` (optionally
 * preceded by wiping `build/` to dodge a stale-manifest bug, see below)
 * writes into `build/` in place. For the whole duration of that build -
 * easily 10-20+ seconds - `build/` is either empty or a mix of old and
 * half-written new files. Any request during that window for a route the
 * running process hasn't already warmed throws
 * `ERR_MODULE_NOT_FOUND: Cannot find module '.../build/server/chunks/...'`
 * chasing a chunk file that's been deleted or not yet written. This isn't
 * rare - it's guaranteed for any cold route, on every single deploy, for
 * as long as the build takes.
 *
 * Building into a separate staging directory - never touching the live
 * `build/` until the finished result is swapped in - closes that window
 * down from "the whole build" to "one near-instant directory rename".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SETUP
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Copy this file into your SvelteKit project as `scripts/build.mjs`.
 *    No npm install needed - only uses Node builtins plus your project's
 *    own local `vite`.
 *
 * 2. In svelte.config.js, make the adapter-node output directory
 *    configurable via BUILD_OUT_DIR (falls back to 'build', so running
 *    `vite build`/`vite preview` directly, outside this script, is
 *    unaffected):
 *
 *      import adapter from '@sveltejs/adapter-node';
 *      export default {
 *          kit: { adapter: adapter({ out: process.env.BUILD_OUT_DIR || 'build' }) }
 *      };
 *
 * 3. In package.json, point the "build" script at this file instead of
 *    `vite build` directly:
 *
 *      "scripts": { "build": "node scripts/build.mjs" }
 *
 * That's the whole setup - no config file, no flags to remember.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Wipes `.svelte-kit` fresh. That's vite's own build cache - nothing at
 *    runtime reads from it, only this build step - so it's always safe to
 *    clear, and doing so on every build is what actually prevents a
 *    separate, narrower bug where a long-lived `.svelte-kit` cache can
 *    silently drop a newly-added route from the final manifest even
 *    though the build reports success.
 * 2. Runs `vite build` with its output redirected to `build.staging/`
 *    (via BUILD_OUT_DIR) - the live `build/` directory is completely
 *    untouched for the entire build.
 * 3. Only once that build succeeds: renames `build/` to `build.old/`,
 *    renames `build.staging/` to `build/`, then removes `build.old/`.
 *
 * Step 3 is two renames, not one - a directory can't be atomically
 * replaced by another non-empty directory in a single syscall on ext4.
 * There's a sub-millisecond gap between them where `build/` doesn't
 * exist, versus the many-seconds gap of rebuilding in place. A
 * symlink-indirection scheme (`build` as a symlink flipped between two
 * real directories) would close that gap entirely, but wasn't worth the
 * added complexity here - revisit if this class of bug ever recurs.
 *
 * If the build itself fails, this script throws before the swap - the
 * live `build/` is left completely untouched, and whatever's already
 * running keeps running unaffected.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, renameSync } from 'node:fs';
import path from 'node:path';

const dir = process.cwd();
const STAGING = path.join(dir, 'build.staging');
const LIVE = path.join(dir, 'build');
const OLD = path.join(dir, 'build.old');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isLockError = (err) => err.code === 'EPERM' || err.code === 'EBUSY';

// On Windows a directory cannot be renamed while any process holds an open
// handle to it or to a directory beneath it, and the rename fails with
// EPERM/EBUSY. Two very different things produce that same code:
//
//   Transient - an AV real-time scan or a search indexer briefly opened a
//   file vite just wrote, or NTFS hasn't finished releasing a path's
//   metadata. These clear on their own within a few seconds, which is what
//   retrying buys us.
//
//   Persistent - a long-lived directory watcher, almost always a `vite dev`
//   server still running against this project, or an Explorer window or
//   shell sitting inside the directory. No amount of retrying will help;
//   the holder has to be stopped.
//
// Retrying is harmless on Linux, where neither case happens - rename either
// succeeds immediately or fails for a real reason, which still surfaces
// after the retries.
async function renameWithRetry(from, to, attempts = 20, delayMs = 300) {
    for (let i = 0; i < attempts; i++) {
        try {
            renameSync(from, to);
            return;
        } catch (err) {
            if (!isLockError(err)) throw err;
            if (i === attempts - 1) throw lockError(from, to, err, attempts, delayMs);
            await sleep(delayMs);
        }
    }
}

// A bare `EPERM: operation not permitted, rename` says nothing about why,
// and the retry loop means it only appears after several silent seconds -
// long enough to read as a hang. Say what actually holds the directory and
// what state the tree was left in.
function lockError(from, to, cause, attempts, delayMs) {
    const seconds = ((attempts * delayMs) / 1000).toFixed(1);
    return new Error(
        `${cause.code} renaming ${path.basename(from)} -> ${path.basename(to)} ` +
            `after ${attempts} attempts over ${seconds}s.\n\n` +
            `Some process holds an open handle on ${path.basename(from)} or a directory ` +
            `inside it. Retrying only clears transient holders (AV scan, search indexer); ` +
            `this one is persistent.\n\n` +
            `The usual culprit is a \`vite dev\` / \`npm run dev\` server still running ` +
            `against this project, or an Explorer window or shell sitting inside the ` +
            `directory. Stop it and re-run \`npm run build\`.\n\n` +
            `To identify the holder:  handle64.exe "${from}"   (Sysinternals)`,
        { cause },
    );
}

rmSync(path.join(dir, '.svelte-kit'), { recursive: true, force: true });
rmSync(STAGING, { recursive: true, force: true });
rmSync(OLD, { recursive: true, force: true });

// Invoke vite via process.execPath + its real entry file rather than
// `npm run build`/the node_modules/.bin/vite shell shim - avoids any
// PATH-dependent lookup, which matters under a process supervisor like
// pm2 (launched via nvm) whose environment may not have npm, or even a
// bare `node` command, on PATH.
execSync(`"${process.execPath}" "${path.join(dir, 'node_modules/vite/bin/vite.js')}" build`, {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, BUILD_OUT_DIR: 'build.staging' },
});

// The swap is two renames, and only the first one is guaranteed to be
// undoable. If `build.staging` -> `build` fails - and it can, because
// staging is a freshly-written tree and so exactly the kind a watcher or
// scanner latches onto - we've already moved `build` out of the way, and
// bailing here would leave no `build/` at all: a running server starts
// 404ing every asset it hasn't already cached. Put it back before rethrowing
// so a failed swap is always a no-op rather than an outage.
if (existsSync(LIVE)) await renameWithRetry(LIVE, OLD);
try {
    await renameWithRetry(STAGING, LIVE);
} catch (err) {
    if (!existsSync(LIVE) && existsSync(OLD)) {
        try {
            renameSync(OLD, LIVE);
        } catch (rollbackErr) {
            throw new Error(
                `${err.message}\n\n` +
                    `Rollback also failed: could not restore build.old -> build ` +
                    `(${rollbackErr.code}). The live build/ directory is MISSING. ` +
                    `Restore it by hand: rename build.old to build.`,
                { cause: err },
            );
        }
    }
    throw err;
}
rmSync(OLD, { recursive: true, force: true });
