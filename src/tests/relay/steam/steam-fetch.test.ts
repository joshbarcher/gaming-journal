// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/fetch.test.js (node:test → vitest).
// Covers the shared steam-fetch utility (ported in Wave 1 without its suite);
// brought over with the steam core port since every steam sync rides on it.
// No disk access — fetch and setTimeout are stubbed.
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import { steamFetch, processBatch } from '../../../lib/server/relay/shared/steam-fetch.js';

describe('steamFetch', () => {
    let originalFetch;

    beforeAll(() => { originalFetch = global.fetch; });
    afterAll(() => { global.fetch = originalFetch; });

    it('returns the response when Steam replies ok', async () => {
        global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
        const res = await steamFetch('https://api.steampowered.com/test');
        assert.equal(res.status, 200);
        assert.equal(global.fetch.mock.calls.length, 1);
    });

    it('throws immediately on a non-retryable error (e.g. 403)', async () => {
        global.fetch = vi.fn(async () => ({ ok: false, status: 403, statusText: 'Forbidden', headers: { get: () => null } }));
        await assert.rejects(() => steamFetch('https://api.steampowered.com/test'), /403/);
        assert.equal(global.fetch.mock.calls.length, 1);
    });

    it('retries on 5xx with exponential backoff and eventually throws', async () => {
        const delays = [];
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (fn, ms) => { delays.push(ms); return originalSetTimeout(fn, 0); };

        global.fetch = vi.fn(async () => ({
            ok: false, status: 503, statusText: 'Service Unavailable',
            headers: { get: () => null },
        }));

        await assert.rejects(() => steamFetch('https://api.steampowered.com/test'), /503/);

        assert.equal(global.fetch.mock.calls.length, 4);
        assert.deepEqual(delays, [1_000, 2_000, 4_000]);

        global.setTimeout = originalSetTimeout;
    });

    it('respects Retry-After header on 429', async () => {
        const delays = [];
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (fn, ms) => { delays.push(ms); return originalSetTimeout(fn, 0); };

        let call = 0;
        global.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return {
                ok: false, status: 429, statusText: 'Too Many Requests',
                headers: { get: (h) => h === 'Retry-After' ? '30' : null },
            };
            return { ok: true, status: 200 };
        });

        const res = await steamFetch('https://api.steampowered.com/test');
        assert.equal(res.status, 200);
        assert.deepEqual(delays, [30_000]);

        global.setTimeout = originalSetTimeout;
    });
});

describe('processBatch', () => {
    it('calls the handler once per item in order', async () => {
        const called = [];
        await processBatch([1, 2, 3], async (item) => { called.push(item); }, { requestsPerSecond: 100 });
        assert.deepEqual(called, [1, 2, 3]);
    });

    it('does nothing for an empty array', async () => {
        let calls = 0;
        await processBatch([], async () => { calls++; }, { requestsPerSecond: 1 });
        assert.equal(calls, 0);
    });

    it('passes index and total to the handler', async () => {
        const meta = [];
        await processBatch(['a', 'b'], async (item, i, total) => { meta.push({ item, i, total }); }, { requestsPerSecond: 100 });
        assert.deepEqual(meta, [
            { item: 'a', i: 0, total: 2 },
            { item: 'b', i: 1, total: 2 },
        ]);
    });

    it('calls onProgress after each item', async () => {
        const progress = [];
        await processBatch([1, 2, 3], async () => {}, {
            requestsPerSecond: 100,
            onProgress: (done, total) => progress.push({ done, total }),
        });
        assert.deepEqual(progress, [{ done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
    });
});
