// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/thegamer-cache.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it, beforeEach, afterAll as after } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    loadCrawlCache, allowlistIsFresh, isDead, dropStaleVerdicts, cacheEntryMatches,
    isPermanentFailure,
} from '../../../lib/server/relay/guides/thegamer/fetcher.js';

const DAY = 24 * 60 * 60 * 1000;
const dirs = [];
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'tg-cache-')); dirs.push(d); return d; }
after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

// ── Loading ──────────────────────────────────────────────────────────────────

describe('loadCrawlCache', () => {
    it('returns an empty cache when the file is absent', async () => {
        const c = await loadCrawlCache(await tmp());
        assert.deepEqual(c.pages, {});
        assert.deepEqual(c.dead, {});
        assert.equal(c.allowlist, null);
    });

    it('rebuilds rather than throwing on a corrupt cache', async () => {
        const d = await tmp();
        await writeFile(join(d, '_crawl-cache.json'), '{ not json', 'utf8');
        assert.deepEqual((await loadCrawlCache(d)).pages, {});
    });

    it('discards a cache written by an older version', async () => {
        const d = await tmp();
        await writeFile(join(d, '_crawl-cache.json'), JSON.stringify({ version: 0, pages: { a: {} } }), 'utf8');
        assert.deepEqual((await loadCrawlCache(d)).pages, {});
    });

    it('expires dead entries past the retry window, keeps recent ones', async () => {
        // A 404 today may be a live article next month.
        const d = await tmp();
        const now = 100 * DAY;
        await writeFile(join(d, '_crawl-cache.json'), JSON.stringify({
            version: 1, pages: {}, offTopic: {}, allowlist: null, rootTags: [],
            dead: {
                old:    { at: now - 31 * DAY, status: 404 },
                recent: { at: now - 2 * DAY,  status: 404 },
            },
        }), 'utf8');

        const c = await loadCrawlCache(d, now);
        assert.ok(!isDead(c, 'old'), 'a 31-day-old 404 is retried');
        assert.ok(isDead(c, 'recent'), 'a 2-day-old 404 is still skipped');
    });
});

// ── What counts as dead ──────────────────────────────────────────────────────
//
// Only a permanently-wrong URL earns a 30-day blacklist. Caching a transient failure
// would bury a good article — and a crawl run while the site is rate-limiting us would
// bury hundreds.

describe('isPermanentFailure', () => {
    const err = status => Object.assign(new Error(`HTTP ${status} for x`), { status });

    it('treats 404 and 410 as permanent', () => {
        assert.ok(isPermanentFailure(err(404)));
        assert.ok(isPermanentFailure(err(410)));
    });

    it('does NOT blacklist a rate-limit', () => {
        assert.ok(!isPermanentFailure(err(429)));
    });

    it('does NOT blacklist a server error', () => {
        assert.ok(!isPermanentFailure(err(500)));
        assert.ok(!isPermanentFailure(err(503)));
    });

    it('does NOT blacklist a bot-block', () => {
        assert.ok(!isPermanentFailure(err(403)));
    });

    it('does NOT blacklist a timeout or connection reset (no status at all)', () => {
        assert.ok(!isPermanentFailure(new Error('Navigation timeout of 30000 ms exceeded')));
        assert.ok(!isPermanentFailure(new Error('net::ERR_CONNECTION_RESET')));
    });

    it('does not throw on a missing error', () => {
        assert.ok(!isPermanentFailure(undefined));
    });
});

describe('loadCrawlCache — legacy dead entries', () => {
    it('keeps a pre-classification entry that is provably a 404', async () => {
        const d = await tmp();
        await writeFile(join(d, '_crawl-cache.json'), JSON.stringify({
            version: 1, pages: {}, offTopic: {}, allowlist: null, rootTags: [],
            dead: { gone: { at: Date.now(), error: 'HTTP 404 for https://x/gone/' } },
        }), 'utf8');
        assert.ok(isDead(await loadCrawlCache(d), 'gone'));
    });

    it('drops a pre-classification entry that may have been transient', async () => {
        // Written before `status` existed — a timeout looked identical to a 404.
        const d = await tmp();
        await writeFile(join(d, '_crawl-cache.json'), JSON.stringify({
            version: 1, pages: {}, offTopic: {}, allowlist: null, rootTags: [],
            dead: { maybe: { at: Date.now(), error: 'Navigation timeout of 30000 ms exceeded' } },
        }), 'utf8');
        assert.ok(!isDead(await loadCrawlCache(d), 'maybe'));
    });
});

// ── Allowlist freshness ──────────────────────────────────────────────────────

describe('allowlistIsFresh', () => {
    const root = new Set(['persona-5-royal', 'persona-5']);
    const cache = (over = {}) => ({ allowlist: { fetchedAt: 0, tags: ['persona-5', 'persona-5-royal'], slugs: ['a'], ...over } });

    it('is fresh inside the TTL', () => {
        assert.ok(allowlistIsFresh(cache({ fetchedAt: 6 * DAY }), root, 6 * DAY + 1000));
    });

    it('is stale past the TTL — new articles get tagged over time', () => {
        assert.ok(!allowlistIsFresh(cache({ fetchedAt: 0 }), root, 8 * DAY));
    });

    it('is stale when the root tags changed — it described a different topic', () => {
        assert.ok(!allowlistIsFresh(cache({ fetchedAt: 0 }), new Set(['elden-ring']), 1000));
    });

    it('ignores tag ordering', () => {
        assert.ok(allowlistIsFresh(cache({ fetchedAt: 0, tags: ['persona-5-royal', 'persona-5'] }), root, 1000));
    });

    it('is stale when never written', () => {
        assert.ok(!allowlistIsFresh({ allowlist: null }, root, 1000));
    });
});

// ── Off-topic verdicts ───────────────────────────────────────────────────────

describe('dropStaleVerdicts', () => {
    it('keeps verdicts when the root tags are unchanged', () => {
        const c = { rootTags: ['persona-5'], offTopic: { gollum: { at: 1 } } };
        dropStaleVerdicts(c, new Set(['persona-5']));
        assert.ok(c.offTopic.gollum);
    });

    it('drops every verdict when the root tags change', () => {
        // "off-topic" was judged relative to the old tags; it means nothing now.
        const c = { rootTags: ['persona-5'], offTopic: { gollum: { at: 1 } } };
        dropStaleVerdicts(c, new Set(['elden-ring']));
        assert.deepEqual(c.offTopic, {});
        assert.deepEqual(c.rootTags, ['elden-ring']);
    });

    it('is order-insensitive', () => {
        const c = { rootTags: ['b', 'a'], offTopic: { x: { at: 1 } } };
        dropStaleVerdicts(c, new Set(['a', 'b']));
        assert.ok(c.offTopic.x);
    });
});

// ── Page entry validity ──────────────────────────────────────────────────────

describe('cacheEntryMatches', () => {
    const stats = { mtimeMs: 1234, size: 5678 };

    it('matches an unchanged file', () => {
        assert.ok(cacheEntryMatches({ mtimeMs: 1234, size: 5678 }, stats));
    });

    it('misses when the file was rewritten (mtime moved)', () => {
        assert.ok(!cacheEntryMatches({ mtimeMs: 1, size: 5678 }, stats));
    });

    it('misses when the size changed', () => {
        assert.ok(!cacheEntryMatches({ mtimeMs: 1234, size: 1 }, stats));
    });

    it('misses when there is no entry', () => {
        assert.ok(!cacheEntryMatches(undefined, stats));
    });
});
