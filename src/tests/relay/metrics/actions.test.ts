// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/actions.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// The journal's actions.js stubs 'mail' (relay-owned forever) with an
// explicit-throw action, keeping its key so the registry drift test below
// stays byte-identical — canSync/listActions see the same map as the relay's.
// 'steam:sessions' is REAL as of Wave 4 (takeSnapshot/deriveSessions from the
// ported sessions.service) — exercised for real at the bottom of this file.
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// services read env at call time, so module-scope assignment is safe despite
// import hoisting.
import { test, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import url from 'node:url';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-actions-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;
process.env.DISABLE_RATE_LIMIT = '1'; // steamFetch sleeps protect Steam; fetch is stubbed below

import { canSync, listActions, startSync, ConflictError, combine } from '../../../lib/server/relay/metrics/actions.js';
import { begin, isRunning, _reset } from '../../../lib/server/relay/metrics/job-guard.js';
import { SOURCES, isKnownSource } from '../../../lib/server/relay/metrics/sources.js';
import { load, close } from '../../../lib/server/relay/metrics/sync-metrics.service.js';

// Journal-side buckets live in metrics/journal (transitional single-writer split — see sync-metrics.service.js metricsDir()).
const METRICS_DIR = path.join(process.env.DATA_DIR, 'relay', 'metrics', 'journal');

// The stub-action test below drives startSync → tracked() → recordRun for real,
// so the metrics store needs the same temp-dir lifecycle as tracked.test.ts.
beforeAll(async () => {
    await fsp.mkdir(METRICS_DIR, { recursive: true });
    await load();
});

afterAll(async () => {
    await close();
    await fsp.rm(process.env.DATA_DIR!, { recursive: true, force: true });
});

beforeEach(() => _reset());

describe('action registry', () => {
    test('every action targets a real source id', () => {
        for (const id of listActions()) {
            assert.equal(isKnownSource(id), true, `action ${id} is not in SOURCES`);
        }
    });

    test('the registry\'s syncable flag matches the action map exactly', () => {
        // dashboard.service reads `syncable` from SOURCES to avoid importing this
        // module (and Puppeteer) onto the request path. If the two drift, the UI
        // shows a button that 404s, or hides one that would have worked.
        const flagged = SOURCES.filter(s => s.syncable).map(s => s.id).sort();
        assert.deepEqual(listActions().sort(), flagged);
    });

    test('canSync agrees with the action map', () => {
        assert.equal(canSync('itad'), true);
        assert.equal(canSync('hltb'), true);
        assert.equal(canSync('steam:library'), true);
    });

    test('sources without a whole-source entrypoint are not syncable', () => {
        // news needs an appid, videos is a CLI tool, account has no sync fn.
        assert.equal(canSync('steam:news'),    false);
        assert.equal(canSync('steam:videos'),  false);
        assert.equal(canSync('steam:account'), false);
        assert.equal(canSync('metrics'),       false);
    });
});

describe('manual triggers are not heavier than their timers', () => {
    test('only steam:library forces, because force there is three cheap API calls', () => {
        // For the sweeping syncs, `force` does not skip a cheap TTL check — it
        // replaces the whole work selection with "every game", each costing an
        // upstream request (and, for achievements and pcgw, a Puppeteer scrape).
        // A button labelled "Sync" must never hit an upstream harder than the
        // scheduler that normally drives it.
        const source = fs.readFileSync(
            path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../../../lib/server/relay/metrics/actions.js'),
            'utf8',
        );
        const actionsBlock = source.slice(source.indexOf('const ACTIONS = {'), source.indexOf('/** True when `id` has a manual trigger. */'));

        const forced = [...actionsBlock.matchAll(/force:\s*true/g)];
        assert.equal(forced.length, 3, 'expected exactly the three steam:library sub-syncs to force');

        const libraryBlock = actionsBlock.slice(
            actionsBlock.indexOf("'steam:library'"),
            actionsBlock.indexOf("'steam:sessions'"),
        );
        assert.equal([...libraryBlock.matchAll(/force:\s*true/g)].length, 3, 'all forcing must live in steam:library');
    });
});

describe('combine', () => {
    test('sums every counter across sub-syncs', () => {
        assert.deepEqual(
            combine([
                { fetched: 1, created: 2, updated: 3, skipped: 4, failed: 5, total: 6 },
                { fetched: 1, created: 2, updated: 3, skipped: 4, failed: 5, total: 6 },
            ]),
            { fetched: 2, created: 4, updated: 6, skipped: 8, failed: 10, total: 12 },
        );
    });

    test('carries created and updated through', () => {
        // Dropping these silently charted every multi-step manual sync — the
        // library trigger runs three sub-syncs — as producing nothing new.
        const result = combine([{ fetched: 2000, created: 1 }, { fetched: 30, created: 2 }]);
        assert.equal(result.created, 3);
    });

    test('tolerates a sub-sync that returned nothing', () => {
        assert.deepEqual(
            combine([undefined, null, { fetched: 1 }]),
            { fetched: 1, created: 0, updated: 0, skipped: 0, failed: 0, total: 0 },
        );
    });

    test('an empty list sums to zero', () => {
        assert.deepEqual(combine([]), { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, total: 0 });
    });
});

describe('startSync', () => {
    test('rejects an unknown source without touching the guard', () => {
        assert.throws(() => startSync('not-a-source'), /No sync action/);
    });

    test('throws ConflictError when a run is already in flight', () => {
        // Claim the slot first so startSync short-circuits before invoking the
        // real sync — this asserts the guard without hitting the network.
        begin('itad');
        assert.throws(() => startSync('itad'), ConflictError);
    });

    test('the conflict carries the source id for the 409 body', () => {
        begin('pcgw');
        try {
            startSync('pcgw');
            assert.fail('expected ConflictError');
        } catch (err) {
            assert.equal(err instanceof ConflictError, true);
            assert.equal(err.id, 'pcgw');
            assert.match(err.message, /already in progress/);
        }
    });
});

// ── Journal-only additions (not in the relay suite) ───────────────────────────
// The remaining stubbed action must refuse loudly, not silently no-op — a manual
// trigger that "succeeds" while doing nothing would chart a healthy run for a
// sync that never happened.

describe('relay-owned action stubs', () => {
    test('mail stays listed (registry parity) but its action throws', async () => {
        assert.equal(canSync('mail'), true);

        // startSync routes the rejection into the run history (logged failed
        // run) and releases the guard — the stub must not wedge the slot.
        await startSync('mail');
        assert.equal(isRunning('mail'), false, 'guard released after the stub throws');

        // Released means a re-trigger is not a 409.
        assert.equal(begin('mail'), true);
    });
});

// Wave 4 restored the real steam:sessions action (the journal-only explicit-throw
// stub is gone). The trigger must actually take a snapshot and derive sessions —
// asserting only "did not throw" would pass for a silent no-op too, so check the
// snapshot really landed on disk.
describe('steam:sessions manual trigger (Wave 4 restore)', () => {
    test('startSync takes a real snapshot and releases the guard', async () => {
        assert.equal(canSync('steam:sessions'), true);

        process.env.STEAM_API_KEY = 'test-key';
        process.env.STEAM_ID      = '76561198000000000';
        await fsp.mkdir(path.join(process.env.DATA_DIR!, 'relay', 'steam'), { recursive: true });

        const originalFetch = global.fetch;
        global.fetch = (async () => ({
            ok: true,
            json: async () => ({
                response: {
                    total_count: 1,
                    games: [{ appid: 10, name: 'Game One', playtime_forever: 120 }],
                },
            }),
        })) as any;
        try {
            await startSync('steam:sessions');
        } finally {
            global.fetch = originalFetch;
        }

        assert.equal(isRunning('steam:sessions'), false, 'guard released after the run');

        // The action really ran: the snapshot landed in the temp DATA_DIR.
        const snap = JSON.parse(await fsp.readFile(
            path.join(process.env.DATA_DIR!, 'relay', 'steam', 'playtime-snapshots.json'), 'utf8'));
        assert.equal(snap.snapshots.length, 1);
        assert.equal(snap.snapshots[0].games[0].appid, 10);

        // Released means a re-trigger is not a 409.
        assert.equal(begin('steam:sessions'), true);
    });
});

