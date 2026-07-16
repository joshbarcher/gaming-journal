// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/itad/itad.test.js (node:test → vitest).
// Contract tests for the shape helpers — behavior must match the relay exactly
// (docs/relay-fold-in.md §6: parity is the correctness definition during
// migration, so assertions are carried over unmodified).
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

process.env.ITAD_API_KEY = 'test-key'
process.env.ITAD_COUNTRY = 'US'
// os.tmpdir(), not a literal '/tmp' — on Windows that would resolve to C:\tmp.
process.env.DATA_DIR = path.join(os.tmpdir(), 'relay-test-itad')

import {
    shapeDeal,
    shapeHistoricalLow,
    filterAndSortDeals,
    priceSignature,
    STORES,
    STORE_IDS,
} from '../../lib/server/relay/itad/itad.service.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDeal(overrides: Record<string, unknown> = {}) {
    return {
        shop:    { id: 61, name: 'Steam' },
        price:   { amount: 29.99, amountInt: 2999, currency: 'USD' },
        regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
        cut:     50,
        url:     'https://store.steampowered.com/app/1091500',
        ...overrides,
    }
}

function makeRawLow(overrides: Record<string, unknown> = {}) {
    return {
        shop:      { id: 36, name: 'GreenManGaming' },
        price:     { amount: 11.99, amountInt: 1199, currency: 'USD' },
        cut:       80,
        timestamp: '2023-11-20T17:30:00+02:00',
        ...overrides,
    }
}

// ── shapeDeal ─────────────────────────────────────────────────────────────────

describe('shapeDeal', () => {
    test('extracts expected fields', () => {
        const result = shapeDeal(makeDeal())
        assert.deepEqual(result, {
            store:   'Steam',
            storeId: 61,
            price:   29.99,
            regular: 59.99,
            cut:     50,
            url:     'https://store.steampowered.com/app/1091500',
        })
    })

    test('preserves zero cut (full price)', () => {
        const result = shapeDeal(makeDeal({ cut: 0, price: { amount: 59.99 }, regular: { amount: 59.99 } }))
        assert.equal(result.cut, 0)
        assert.equal(result.price, 59.99)
    })
})

// ── shapeHistoricalLow ────────────────────────────────────────────────────────

describe('shapeHistoricalLow', () => {
    test('extracts expected fields', () => {
        const result = shapeHistoricalLow(makeRawLow())
        assert.deepEqual(result, {
            price: 11.99,
            cut:   80,
            store: 'GreenManGaming',
            date:  '2023-11-20',
        })
    })

    test('returns null when input is null', () => {
        assert.equal(shapeHistoricalLow(null), null)
    })

    test('returns null date when timestamp is missing', () => {
        const result = shapeHistoricalLow(makeRawLow({ timestamp: null }))
        assert.equal(result.date, null)
    })
})

// ── filterAndSortDeals ────────────────────────────────────────────────────────

describe('filterAndSortDeals', () => {
    test('filters out non-opted-in stores', () => {
        const raw = [
            makeDeal({ shop: { id: 61, name: 'Steam'     }, price: { amount: 59.99 }, regular: { amount: 59.99 }, cut: 0  }),
            makeDeal({ shop: { id: 35, name: 'Epic'      }, price: { amount: 39.99 }, regular: { amount: 59.99 }, cut: 33 }),
            makeDeal({ shop: { id:  2, name: 'GOG'       }, price: { amount: 35.99 }, regular: { amount: 59.99 }, cut: 40 }),
            makeDeal({ shop: { id:  6, name: 'Fanatical' }, price: { amount: 29.99 }, regular: { amount: 59.99 }, cut: 50 }),
        ]
        const result = filterAndSortDeals(raw)
        const ids = result.map((d: { storeId: number }) => d.storeId)
        assert.ok(!ids.includes(35), 'epic should be excluded')
        assert.ok(!ids.includes(2),  'gog should be excluded')
        assert.ok(ids.includes(61),  'steam should be included')
        assert.ok(ids.includes(6),   'fanatical should be included')
    })

    test('sorts by price ascending', () => {
        const raw = [
            makeDeal({ shop: { id: 61, name: 'Steam'     }, price: { amount: 59.99 }, regular: { amount: 59.99 }, cut: 0  }),
            makeDeal({ shop: { id:  6, name: 'Fanatical' }, price: { amount: 29.99 }, regular: { amount: 59.99 }, cut: 50 }),
            makeDeal({ shop: { id: 36, name: 'GMG'       }, price: { amount: 35.99 }, regular: { amount: 59.99 }, cut: 40 }),
        ]
        const result = filterAndSortDeals(raw)
        assert.equal(result[0].price, 29.99)
        assert.equal(result[1].price, 35.99)
        assert.equal(result[2].price, 59.99)
    })

    test('returns empty array when input is null or empty', () => {
        assert.deepEqual(filterAndSortDeals(null), [])
        assert.deepEqual(filterAndSortDeals([]), [])
    })

    test('returns empty array when no deals match opted-in stores', () => {
        const raw = [
            makeDeal({ shop: { id: 35, name: 'Epic' }, price: { amount: 9.99  }, regular: { amount: 59.99 }, cut: 83 }),
            makeDeal({ shop: { id:  2, name: 'GOG'  }, price: { amount: 14.99 }, regular: { amount: 59.99 }, cut: 75 }),
        ]
        assert.deepEqual(filterAndSortDeals(raw), [])
    })
})

// ── priceSignature ────────────────────────────────────────────────────────────
// Not covered by the relay's itad.test.js (it lives in novelty-signatures.test.js
// there) — included here so the itad port carries its own novelty contract.

describe('priceSignature', () => {
    const entry = {
        deals: [
            { storeId: 61, price: 29.99, cut: 50, url: 'https://a', resolvedAt: '2026-01-01' },
            { storeId: 6,  price: 27.99, cut: 53, url: 'https://b' },
        ],
        historicalLow: { price: 11.99, date: '2023-11-20' },
        fetchedAt: '2026-07-01T00:00:00Z',
    }

    test('ignores url/resolvedAt/fetchedAt churn', () => {
        const same = {
            ...entry,
            fetchedAt: '2026-07-16T00:00:00Z',
            deals: entry.deals.map(d => ({ ...d, url: 'https://changed', resolvedAt: '2026-07-16' })),
        }
        assert.equal(priceSignature(entry), priceSignature(same))
    })

    test('changes when a price moves', () => {
        const moved = { ...entry, deals: [{ ...entry.deals[0], price: 19.99 }, entry.deals[1]] }
        assert.notEqual(priceSignature(entry), priceSignature(moved))
    })

    test('is stable across deal ordering', () => {
        const reversed = { ...entry, deals: [...entry.deals].reverse() }
        assert.equal(priceSignature(entry), priceSignature(reversed))
    })

    test('empty entries produce the empty signature', () => {
        assert.equal(priceSignature(null), '#')
        assert.equal(priceSignature({ deals: [], historicalLow: null }), '#')
    })
})

// ── STORES config ─────────────────────────────────────────────────────────────

describe('STORES config', () => {
    test('contains exactly the nine opted-in stores', () => {
        const ids = STORES.map((s: { id: number }) => s.id).sort((a: number, b: number) => a - b)
        assert.deepEqual(ids, [6, 20, 26, 27, 28, 29, 36, 37, 61])
    })

    test('STORE_IDS set matches STORES list', () => {
        for (const s of STORES) assert.ok(STORE_IDS.has(s.id))
        assert.equal(STORE_IDS.size, STORES.length)
    })
})
