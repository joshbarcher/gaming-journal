// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/novelty-signatures.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified). Overlaps a little with the signature tests already
// in src/tests/relay/itad.test.ts — kept 1:1 with the relay file anyway so the
// two suites stay diffable.
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-novelty-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;

import { priceSignature } from '../../../lib/server/relay/itad/itad.service.js';
import { tierSignature }  from '../../../lib/server/relay/protondb/protondb.service.js';

// ── ITAD price signature ──────────────────────────────────────────────────────

const deal = (storeId, price, cut = 0, extra = {}) => ({ storeId, price, cut, store: 'S', ...extra });

describe('priceSignature', () => {
    test('two entries with the same prices share a signature', () => {
        const a = { deals: [deal(1, 9.99), deal(2, 12.5)], historicalLow: { price: 4.99, date: '2026-01-01' } };
        const b = { deals: [deal(1, 9.99), deal(2, 12.5)], historicalLow: { price: 4.99, date: '2026-01-01' } };
        assert.equal(priceSignature(a), priceSignature(b));
    });

    test('a price change changes the signature', () => {
        const before = { deals: [deal(1, 9.99)] };
        const after  = { deals: [deal(1, 7.99)] };
        assert.notEqual(priceSignature(before), priceSignature(after));
    });

    test('a discount change changes the signature even at the same price', () => {
        const before = { deals: [deal(1, 9.99, 0)] };
        const after  = { deals: [deal(1, 9.99, 50)] };
        assert.notEqual(priceSignature(before), priceSignature(after));
    });

    test('a new historical low changes the signature', () => {
        const before = { deals: [], historicalLow: { price: 5, date: '2026-01-01' } };
        const after  = { deals: [], historicalLow: { price: 3, date: '2026-07-01' } };
        assert.notEqual(priceSignature(before), priceSignature(after));
    });

    test('a store appearing or disappearing changes the signature', () => {
        const before = { deals: [deal(1, 9.99)] };
        const after  = { deals: [deal(1, 9.99), deal(2, 8.99)] };
        assert.notEqual(priceSignature(before), priceSignature(after));
    });

    // ── The point of the signature: ignore churn that is not a price ──────────

    test('re-resolving a tracking URL does NOT count as a change', () => {
        // resolveEntryUrls() rewrites url + resolvedAt on a 14-day TTL. Counting
        // that as an update would report ~2,000 "new records" every sync.
        const before = { deals: [deal(1, 9.99, 0, { url: 'https://a', resolvedAt: '2026-01-01' })] };
        const after  = { deals: [deal(1, 9.99, 0, { url: 'https://b', resolvedAt: '2026-07-09' })] };
        assert.equal(priceSignature(before), priceSignature(after));
    });

    test('a new fetchedAt alone does NOT count as a change', () => {
        const before = { fetchedAt: '2026-07-01T00:00:00Z', deals: [deal(1, 9.99)] };
        const after  = { fetchedAt: '2026-07-09T00:00:00Z', deals: [deal(1, 9.99)] };
        assert.equal(priceSignature(before), priceSignature(after));
    });

    test('deal ordering does not affect the signature', () => {
        // ITAD does not guarantee a stable order across responses.
        const before = { deals: [deal(1, 9.99), deal(2, 5)] };
        const after  = { deals: [deal(2, 5), deal(1, 9.99)] };
        assert.equal(priceSignature(before), priceSignature(after));
    });

    test('an entry with no deals and no low is stable', () => {
        assert.equal(priceSignature({ deals: [] }), priceSignature({ deals: [], historicalLow: null }));
    });

    test('tolerates a missing or undefined entry', () => {
        assert.equal(priceSignature(undefined), priceSignature(null));
        assert.equal(typeof priceSignature(undefined), 'string');
    });

    test('a game going on sale is detected', () => {
        const before = { deals: [deal(1, 59.99, 0)] };
        const after  = { deals: [deal(1, 29.99, 50)] };
        assert.notEqual(priceSignature(before), priceSignature(after));
    });
});

// ── ProtonDB tier signature ───────────────────────────────────────────────────

const entry = (over = {}) => ({ tier: 'gold', bestReportedTier: 'platinum', trendingTier: 'gold', score: 0.8, total: 100, ...over });

describe('tierSignature', () => {
    test('an unchanged verdict shares a signature', () => {
        assert.equal(tierSignature(entry()), tierSignature(entry()));
    });

    test('a tier promotion changes the signature', () => {
        assert.notEqual(tierSignature(entry()), tierSignature(entry({ tier: 'platinum' })));
    });

    test('a trending tier change changes the signature', () => {
        assert.notEqual(tierSignature(entry()), tierSignature(entry({ trendingTier: 'silver' })));
    });

    // ── The point: report churn is not new information ────────────────────────

    test('drifting score and report count do NOT count as a change', () => {
        // Every game accumulates reports weekly. Treating that as an update
        // would report thousands of "new records" per sync, telling you nothing.
        assert.equal(tierSignature(entry()), tierSignature(entry({ score: 0.81, total: 137 })));
    });

    test('a null tier is distinguishable from a real one', () => {
        assert.notEqual(tierSignature(entry({ tier: null })), tierSignature(entry()));
    });

    test('returns null for a missing entry', () => {
        assert.equal(tierSignature(null), null);
        assert.equal(tierSignature(undefined), null);
    });
});
