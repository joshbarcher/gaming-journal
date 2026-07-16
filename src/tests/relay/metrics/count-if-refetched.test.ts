// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/count-if-refetched.test.js (node:test → vitest).
//
// FULL PORT as of Wave 4. This file landed in Wave 3 as a partial port
// (countNewIds only, against a copy inlined into metrics/actions.js) because
// steam/sessions.service.js — home of both helpers — was relay-owned until the
// live-session machinery ported. Wave 4 ported sessions.service and restored
// actions.js to import countNewIds from it, so both describe blocks now run
// verbatim against the real module, exactly like the relay original.
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-refetch-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;

import { countIfRefetched, countNewIds } from '../../../lib/server/relay/steam/sessions.service.js';
import { toCounts } from '../../../lib/server/relay/metrics/tracked.js';

const size = v => v?.games?.length ?? 0;

describe('countIfRefetched', () => {
    test('counts records as fetched when the sync hit the API', () => {
        const before = '2026-07-08T00:00:00Z';
        const after  = { fetchedAt: '2026-07-09T00:00:00Z', games: [1, 2, 3] };

        assert.deepEqual(countIfRefetched(before, after, size), { fetched: 3, created: 0, total: 3 });
    });

    test('counts records as skipped when the TTL short-circuited the sync', () => {
        // syncGames returns the same cache object it was handed; only fetchedAt tells us.
        const before = '2026-07-09T00:00:00Z';
        const after  = { fetchedAt: '2026-07-09T00:00:00Z', games: [1, 2, 3] };

        assert.deepEqual(countIfRefetched(before, after, size), { fetched: 0, created: 0, skipped: 3, total: 3 });
    });

    test('a re-fetch that pulls 2,000 known games creates none of them', () => {
        // The distinction the chart depends on: pulled ≠ new.
        const after = { fetchedAt: '2026-07-09T00:00:00Z', games: Array(2000).fill(0) };
        const counts = countIfRefetched('2026-07-08T00:00:00Z', after, size, 0);
        assert.equal(counts.fetched, 2000);
        assert.equal(counts.created, 0);
    });

    test('carries the created count through when games were actually added', () => {
        const after = { fetchedAt: '2026-07-09T00:00:00Z', games: Array(2001).fill(0) };
        const counts = countIfRefetched('2026-07-08T00:00:00Z', after, size, 1);
        assert.equal(counts.created, 1);
    });

    test('a cache hit reports zero created even if a count is passed', () => {
        const after = { fetchedAt: '2026-07-09T00:00:00Z', games: [1] };
        const counts = countIfRefetched('2026-07-09T00:00:00Z', after, size, 5);
        assert.equal(counts.created, 0, 'nothing was pulled, so nothing can be new');
    });

    test('a 24h-TTL library sync charts one fetch per day, not one per tick', () => {
        // The bug this guards: 48 ticks/day x 2000 games = 96k phantom records.
        const games = { fetchedAt: '2026-07-09T00:00:00Z', games: Array(2000).fill(0) };

        let charted = 0;
        let cachedAt = null;                       // first tick has no prior fetchedAt
        for (let tick = 0; tick < 48; tick++) {
            const refetched = tick === 0;          // only the first tick misses the cache
            const before = cachedAt;
            const after  = refetched ? games : { ...games, fetchedAt: cachedAt };
            charted += toCounts(countIfRefetched(before, after, size)).fetched;
            cachedAt = games.fetchedAt;
        }
        assert.equal(charted, 2000);
    });

    test('treats a first-ever sync (no prior fetchedAt) as a real fetch', () => {
        const after = { fetchedAt: '2026-07-09T00:00:00Z', games: [1] };
        assert.deepEqual(countIfRefetched(undefined, after, size, 1), { fetched: 1, created: 1, total: 1 });
    });

    test('treats a result with no fetchedAt as skipped rather than crashing', () => {
        assert.deepEqual(countIfRefetched(undefined, {}, size), { fetched: 0, created: 0, skipped: 0, total: 0 });
        assert.deepEqual(countIfRefetched(undefined, undefined, size), { fetched: 0, created: 0, skipped: 0, total: 0 });
    });

    test('works with the wishlist sizer, which counts an items map not an array', () => {
        const sizeItems = v => Object.keys(v?.items ?? {}).length;
        const after = { fetchedAt: '2026-07-09T00:00:00Z', items: { 440: {}, 570: {} } };
        assert.deepEqual(countIfRefetched('2026-07-08T00:00:00Z', after, sizeItems), { fetched: 2, created: 0, total: 2 });
    });
});

describe('countNewIds', () => {
    test('counts ids present after but not before', () => {
        assert.equal(countNewIds([1, 2, 3], [1, 2, 3, 4, 5]), 2);
    });

    test('a re-fetch of the same library creates nothing', () => {
        assert.equal(countNewIds([1, 2, 3], [3, 2, 1]), 0);
    });

    test('a first sync makes every id new', () => {
        assert.equal(countNewIds([], [1, 2]), 2);
    });

    test('removed ids do not count as new', () => {
        assert.equal(countNewIds([1, 2, 3], [1]), 0);
    });

    test('works with string keys, as the wishlist items map produces', () => {
        assert.equal(countNewIds(['440'], ['440', '570']), 1);
    });
});
