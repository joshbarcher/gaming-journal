// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/pins-merge.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR) — the pins
// store lives at $DATA_DIR/gaming-journal/guide-pins.json.
import { describe, it, beforeAll as before, afterAll as after, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import path   from 'node:path';
import os     from 'node:os';
import fs     from 'node:fs/promises';

// pins.service reads process.env.DATA_DIR lazily (inside pinsPath()), so point it at an
// isolated temp dir BEFORE importing the module and each test starts from a clean file.
let tmpDir;
let svc;

const STEAM = '440', SRC = 'ign', GUIDE = 'guide-1';
const pin = (id, slug, extra = {}) => ({
    id, slug, pageLabel: slug, blockPath: [0, 1], label: `pin ${id}`, ...extra,
});

before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pins-test-'));
    process.env.DATA_DIR = tmpDir;
    delete process.env.RELAY_DATA_ROOT;   // pins derive from DATA_DIR alone
    svc = await import('../../../lib/server/relay/guides/pins.service.js');
});

after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
    // Wipe the single JSON store between tests.
    await fs.rm(path.join(tmpDir, 'gaming-journal', 'guide-pins.json'), { force: true });
});

describe('guide pins — delta merge', () => {
    it('two tabs adding different pages both survive (the reported clobber bug)', async () => {
        // Tab A adds a pin on page X.
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('a', 'page-x'));
        // Tab B, holding a stale empty snapshot, adds a pin on page Y.
        const after = await svc.upsertPin(STEAM, SRC, GUIDE, pin('b', 'page-y'));

        const slugs = after.pins.map(p => p.slug).sort();
        assert.deepEqual(slugs, ['page-x', 'page-y'], 'both pins must persist — no clobber');
    });

    it('keeps accumulating across many adds instead of collapsing to two', async () => {
        for (const [id, slug] of [['a', 'p1'], ['b', 'p2'], ['c', 'p3'], ['d', 'p4']]) {
            await svc.upsertPin(STEAM, SRC, GUIDE, pin(id, slug));
        }
        const store = await svc.getPins(STEAM, SRC, GUIDE);
        assert.equal(store.pins.length, 4);
    });

    it('enforces one pin per page by base slug (replace, not duplicate)', async () => {
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('a', 'page-x', { label: 'first' }));
        // A different id on the same page (e.g. a stale tab that regenerated the id) replaces.
        const after = await svc.upsertPin(STEAM, SRC, GUIDE, pin('z', 'page-x', { label: 'second' }));

        assert.equal(after.pins.length, 1);
        assert.equal(after.pins[0].slug, 'page-x');
        assert.equal(after.pins[0].label, 'second');
    });

    it('one pin per page matches on base slug, ignoring #anchor', async () => {
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('a', 'page-x'));
        const after = await svc.upsertPin(STEAM, SRC, GUIDE, pin('b', 'page-x#section-2'));
        assert.equal(after.pins.length, 1, 'anchored slug is the same page');
    });

    it('delete targets a single id and leaves the rest untouched', async () => {
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('a', 'p1'));
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('b', 'p2'));
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('c', 'p3'));

        const after = await svc.deletePin(STEAM, SRC, GUIDE, 'b');
        assert.deepEqual(after.pins.map(p => p.id).sort(), ['a', 'c']);
    });

    it('deleting the last pin drops the guide entry (no empty persistence)', async () => {
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('a', 'p1'));
        await svc.deletePin(STEAM, SRC, GUIDE, 'a');
        const store = await svc.getPins(STEAM, SRC, GUIDE);
        assert.deepEqual(store, { parsedAt: null, pins: [] });
    });

    it('a new parsedAt (guide re-parsed) keeps prior pins — durable, not reset', async () => {
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('a', 'p1'), 'v1');
        await svc.upsertPin(STEAM, SRC, GUIDE, pin('b', 'p2'), 'v1');
        // Guide re-parsed → different parsedAt. Pins are durable now: prior ones survive the add
        // (getPins re-anchors the whole set to the new content by text on the next read).
        const after = await svc.upsertPin(STEAM, SRC, GUIDE, pin('c', 'p3'), 'v2');
        assert.deepEqual(after.pins.map(p => p.id).sort(), ['a', 'b', 'c']);
        // The store keeps the anchor parsedAt (v1) so a later getPins reconciles all pins.
        assert.equal(after.parsedAt, 'v1');
    });

    it('rejects an invalid pin', async () => {
        await assert.rejects(
            () => svc.upsertPin(STEAM, SRC, GUIDE, { id: 'x' /* no slug/blockPath */ }),
            /invalid pin/,
        );
    });

    it('concurrent upserts do not clobber (lock serialises read-modify-write)', async () => {
        await Promise.all([
            svc.upsertPin(STEAM, SRC, GUIDE, pin('a', 'p1')),
            svc.upsertPin(STEAM, SRC, GUIDE, pin('b', 'p2')),
            svc.upsertPin(STEAM, SRC, GUIDE, pin('c', 'p3')),
        ]);
        const store = await svc.getPins(STEAM, SRC, GUIDE);
        assert.equal(store.pins.length, 3, 'all three concurrent adds survive');
    });
});
