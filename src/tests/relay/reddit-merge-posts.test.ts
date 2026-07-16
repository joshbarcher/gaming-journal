// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/reddit/merge-posts.test.js (node:test → vitest).
// Contract tests for the feed-accumulation merge — behavior must match the
// relay exactly (docs/relay-fold-in.md §6: parity is the correctness definition
// during migration, so assertions are carried over unmodified).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// service reads env at call time via featureDir(), so module-scope assignment
// is safe despite import hoisting. mergePosts itself is pure — no browser is
// launched and nothing is written by these tests.
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-reddit-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR

import { mergePosts } from '../../lib/server/relay/reddit/reddit.service.js';

function p(id, createdUtc, overrides = {}) {
    return { id, title: `post ${id}`, score: 10, createdUtc, ...overrides };
}

describe('mergePosts', () => {
    test('dedupes by id, fresh data wins for mutable fields', () => {
        const existing = [p('a', 100, { score: 5, numComments: 1 })];
        const fresh    = [p('a', 100, { score: 99, numComments: 42 })];
        const merged   = mergePosts(existing, fresh);
        assert.equal(merged.length, 1);
        assert.equal(merged[0].score, 99);
        assert.equal(merged[0].numComments, 42);
    });

    test('accumulates — posts absent from fresh are retained', () => {
        const existing = [p('old', 100)];
        const fresh    = [p('new', 200)];
        const merged   = mergePosts(existing, fresh);
        assert.deepEqual(merged.map(m => m.id).sort(), ['new', 'old']);
    });

    test('preserves cached local media on overlap', () => {
        const existing = [p('a', 100, { localImage: '/images/a.jpg', localThumb: '/images/a_t.jpg' })];
        const fresh    = [p('a', 100, { localImage: undefined })];
        const merged   = mergePosts(existing, fresh);
        assert.equal(merged[0].localImage, '/images/a.jpg');
        assert.equal(merged[0].localThumb, '/images/a_t.jpg');
    });

    test('takes fresh media when cache had none', () => {
        const existing = [p('a', 100)];
        const fresh    = [p('a', 100, { localImage: '/images/a.jpg' })];
        const merged   = mergePosts(existing, fresh);
        assert.equal(merged[0].localImage, '/images/a.jpg');
    });

    test('merges gallery localImage per index', () => {
        const existing = [p('a', 100, { galleryImages: [{ url: 'u0', localImage: '/g0.jpg' }, { url: 'u1' }] })];
        const fresh    = [p('a', 100, { galleryImages: [{ url: 'u0' }, { url: 'u1' }] })];
        const merged   = mergePosts(existing, fresh);
        assert.equal(merged[0].galleryImages[0].localImage, '/g0.jpg');
        assert.equal(merged[0].galleryImages[1].url, 'u1');
    });

    test('sorts newest-first', () => {
        const merged = mergePosts([p('old', 100)], [p('mid', 200), p('new', 300)]);
        assert.deepEqual(merged.map(m => m.id), ['new', 'mid', 'old']);
    });

    test('caps at MAX_STORED_POSTS (200), dropping oldest', () => {
        const existing = Array.from({ length: 150 }, (_, i) => p(`e${i}`, i));            // createdUtc 0..149
        const fresh    = Array.from({ length: 150 }, (_, i) => p(`f${i}`, 1000 + i));     // newer
        const merged   = mergePosts(existing, fresh);
        assert.equal(merged.length, 200);
        // Newest first; all 150 fresh survive, oldest existing get dropped
        assert.equal(merged[0].id, 'f149');
        assert.ok(merged.every(m => m.createdUtc >= 50)); // 100 oldest of 300 dropped
    });

    test('handles empty/undefined existing', () => {
        assert.deepEqual(mergePosts(undefined, [p('a', 1)]).map(m => m.id), ['a']);
        assert.deepEqual(mergePosts([], [p('a', 1)]).map(m => m.id), ['a']);
    });
});
