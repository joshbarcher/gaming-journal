// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/admin-actions.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration).
//
// ADAPTATION (framework, not behavior): the relay mounted adminRouter on a live
// Express listener; the journal's admin routes are SvelteKit +server.ts handlers,
// invoked here directly with a stubbed RequestEvent (same pattern as
// src/tests/routes/*). Two consequences:
//   - The "percent-encoded colon" and "raw colon" routing tests collapse into
//     one: SvelteKit (like Express) hands handlers the DECODED param, so both
//     wire forms reach the handler as 'steam:reviews'. The handler-level
//     contract they guarded — a colon id resolving to canSync() — is asserted.
//   - No listener/port lifecycle; RELAY_FORWARD_ADMIN=local pins the wrapper to
//     local mode so a dev .env RELAY_FORWARD can never turn these into proxies.
import { test, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-admin-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;
process.env.RELAY_FORWARD_ADMIN = 'local';
// incrementalScrapeReviews() short-circuits to { added: 0 } without a vanity
// URL, giving us a real action that exercises the whole stack — route → guard →
// tracked() → recordRun — without a network call.
delete process.env.STEAM_VANITY_URL;

import { POST as postSourceSync } from '../../../routes/relay/api/admin/sources/[id]/sync/+server.js';
import { GET as getSources } from '../../../routes/relay/api/admin/sources/+server.js';
import { POST as postDiskRescan } from '../../../routes/relay/api/admin/disk-usage/rescan/+server.js';
import { POST as postProvision } from '../../../routes/relay/api/admin/provision/[appid]/+server.js';
import { POST as postPatch } from '../../../routes/relay/api/admin/patch/[appid]/+server.js';
import { POST as postNewsRefresh } from '../../../routes/relay/api/admin/news/[appid]/refresh/+server.js';
import { load, close, getRuns } from '../../../lib/server/relay/metrics/sync-metrics.service.js';
import { close as closeDisk } from '../../../lib/server/relay/metrics/disk-usage.service.js';
import { isRunning, begin, end, _reset } from '../../../lib/server/relay/metrics/job-guard.js';

// Journal-side buckets live in metrics/journal (transitional single-writer split — see sync-metrics.service.js metricsDir()).
const METRICS_DIR = path.join(process.env.DATA_DIR, 'relay', 'metrics', 'journal');

/** Wait until the fire-and-forget sync releases its guard slot. */
async function waitIdle(id, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (isRunning(id)) {
        if (Date.now() > deadline) throw new Error(`${id} never released its guard`);
        await new Promise(r => setTimeout(r, 10));
    }
}

/** Minimal RequestEvent stub for the admin handlers (they read params/url/request.method). */
function ev(pathname, { params = {}, method = 'POST' } = {}) {
    const url = new URL(`http://journal.test${pathname}`);
    return { params, url, request: new Request(url, { method }) };
}

const postSync = (id) => postSourceSync(ev(`/relay/api/admin/sources/${encodeURIComponent(id)}/sync`, { params: { id } }));

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
    await fs.mkdir(METRICS_DIR, { recursive: true });
});

afterAll(async () => {
    await close();
    await closeDisk();   // the rescan test kicks off a real scanAll over the temp dir
    await fs.rm(process.env.DATA_DIR!, { recursive: true, force: true });
});

beforeEach(async () => {
    _reset();
    await close();
    await fs.rm(METRICS_DIR, { recursive: true, force: true });
    await fs.mkdir(METRICS_DIR, { recursive: true });
    await load();
});

// ── The colon in a source id ──────────────────────────────────────────────────

describe('source id routing', () => {
    test('a colon source id reaches the handler decoded and starts the sync', async () => {
        // The UI sends encodeURIComponent('steam:reviews') → 'steam%3Areviews';
        // SvelteKit decodes params before the handler sees them (as Express did),
        // so canSync() receives 'steam:reviews' either way.
        const res = await postSync('steam:reviews');
        assert.equal(res.status, 202);
        assert.equal((await res.json()).id, 'steam:reviews');
        await waitIdle('steam:reviews');
    });

    test('an unknown source answers 404 and lists what is available', async () => {
        const res = await postSync('not-a-source');
        assert.equal(res.status, 404);

        const body = await res.json();
        assert.match(body.error, /No sync action/);
        assert.ok(body.available.includes('hltb'));
    });

    test('a known source with no trigger answers 404, not 500', async () => {
        const res = await postSync('steam:news');
        assert.equal(res.status, 404);
    });
});

// ── The full stack: route → guard → tracked() → recordRun ─────────────────────

describe('startSync end to end', () => {
    test('a triggered sync records a run in the metrics store', async () => {
        const res = await postSync('steam:reviews');
        assert.equal(res.status, 202);

        await waitIdle('steam:reviews');

        const runs = await getRuns({ sinceMs: Date.now() - 60_000 });
        const run = runs.find(r => r.id === 'steam:reviews');
        assert.ok(run, 'the manual run must land in the history like a scheduled one');
        assert.equal(run.ok, true);
        assert.ok(run.ms >= 0);
    });

    test('the guard is claimed synchronously, before the response is sent', async () => {
        const inFlight = postSync('steam:reviews');
        // Not awaited yet — but startSync() ran begin() before returning.
        const res = await inFlight;
        assert.equal(res.status, 202);
        await waitIdle('steam:reviews');
    });

    test('the guard is released once the sync settles', async () => {
        await postSync('steam:reviews');
        await waitIdle('steam:reviews');
        assert.equal(isRunning('steam:reviews'), false);

        // ...and the source can be triggered again.
        const again = await postSync('steam:reviews');
        assert.equal(again.status, 202);
        await waitIdle('steam:reviews');
    });

    test('an overlapping trigger answers 409 rather than doubling the request rate', async () => {
        begin('itad');   // stand in for a scheduled run already in flight
        try {
            const res = await postSync('itad');
            assert.equal(res.status, 409);

            const body = await res.json();
            assert.equal(body.id, 'itad');
            assert.match(body.error, /already in progress/);
        } finally {
            end('itad');
        }
    });

    test('a 409 does not disturb the in-flight run', async () => {
        begin('itad');
        await postSync('itad');
        assert.equal(isRunning('itad'), true, 'the rejected trigger must not clear the guard');
        end('itad');
    });
});

// ── GET /sources ──────────────────────────────────────────────────────────────

describe('GET /api/admin/sources', () => {
    test('lists triggerable sources and what is running', async () => {
        begin('hltb');
        try {
            const res = await getSources(ev('/relay/api/admin/sources', { method: 'GET' }));
            const body = await res.json();
            assert.ok(body.available.includes('steam:library'));
            assert.deepEqual(body.running, ['hltb']);
            assert.equal(body.diskScanning, false);
        } finally {
            end('hltb');
        }
    });
});

// ── Disk rescan ───────────────────────────────────────────────────────────────

describe('POST /api/admin/disk-usage/rescan', () => {
    test('starts a scan and answers 202', async () => {
        const res = await postDiskRescan(ev('/relay/api/admin/disk-usage/rescan'));
        assert.equal(res.status, 202);
    });
});

// ── Journal-only additions (not in the relay suite) ──────────────────────────
// The appid-validated fire-and-forget handlers must reject garbage BEFORE
// kicking off their background work — these exercise only the 400 guard, so no
// provision/patch/news pipeline ever runs against the temp DATA_DIR.

describe('appid validation on the fire-and-forget admin handlers', () => {
    const bad = (pathname, appid) => ev(pathname, { params: { appid } });

    test('provision rejects a non-numeric appid with 400', async () => {
        const res = await postProvision(bad('/relay/api/admin/provision/nope', 'nope'));
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'invalid appid' });
    });

    test('patch rejects a non-numeric appid with 400', async () => {
        const res = await postPatch(bad('/relay/api/admin/patch/nope', 'nope'));
        assert.equal(res.status, 400);
    });

    test('news refresh rejects a non-numeric appid with 400', async () => {
        const res = await postNewsRefresh(bad('/relay/api/admin/news/nope/refresh', 'nope'));
        assert.equal(res.status, 400);
    });
});
