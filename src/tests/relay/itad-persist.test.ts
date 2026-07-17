// @ts-nocheck — data-integrity regression for ITAD price persistence.
//
// The persist guard must distinguish two cases that both produce "no deals":
//   1. Sale ended — the price BATCH SUCCEEDED and ITAD returned the game with no
//      current deals (nondeals=true). This is real: write the empty deals.
//   2. Transient failure — the batch THREW (429/5xx/network). We don't know the
//      current state, so keep the cached deals rather than zero good data.
// Getting these backwards would either freeze stale sale prices forever (if we
// preserved on success) or wipe good prices on a blip (the original bug).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let dataDir
let itadDir

beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'gj-itad-persist-'))
    process.env.DATA_DIR = dataDir
    delete process.env.RELAY_DATA_ROOT
    process.env.ITAD_API_KEY = 'test-key'
    process.env.ITAD_COUNTRY = 'US'
    itadDir = path.join(dataDir, 'relay', 'itad')
    await mkdir(itadDir, { recursive: true })
})
afterEach(async () => { await rm(dataDir, { recursive: true, force: true }) })

// A cached entry with a real deal + all-time low, itadId already resolved.
const CACHED = {
    appid: 220, steamName: 'Half-Life 2', itadId: 'abc',
    fetchedAt: '2026-01-01T00:00:00Z',
    deals: [{ store: 'Steam', storeId: 61, price: 4.99, regular: 9.99, cut: 50, url: 'https://s', resolvedAt: '2026-01-01T00:00:00Z' }],
    historicalLow: { price: 1.99, cut: 80, store: 'Steam', date: '2023-01-01' },
}

async function seed() { await writeFile(path.join(itadDir, '220.json'), JSON.stringify(CACHED)) }
async function readEntry() { return JSON.parse(await readFile(path.join(itadDir, '220.json'), 'utf8')) }

// prices/historylow succeed with the given deals, or throw (batch failure).
function stubFetch({ deals = [], low = null, fail = false } = {}) {
    return async (url) => {
        if (fail) throw new Error('network')
        const u = String(url)
        if (u.includes('/games/prices/'))    return { ok: true, json: async () => [{ id: 'abc', deals }] }
        if (u.includes('/games/historylow/')) return { ok: true, json: async () => [{ id: 'abc', low }] }
        return { ok: true, json: async () => [] }
    }
}

describe('ITAD price persistence — off-sale vs transient failure', () => {
    it('SALE ENDED: a successful batch with no deals writes empty deals (updates to reality)', async () => {
        const { syncGames } = await import('../../lib/server/relay/itad/itad.service.js')
        await seed()
        const low = { price: { amount: 1.99 }, cut: 80, shop: { name: 'Steam' }, timestamp: '2023-01-01T00:00:00Z' }
        await syncGames([{ appid: 220, name: 'Half-Life 2' }], { force: true, fetchFn: stubFetch({ deals: [], low }) })
        const entry = await readEntry()
        expect(entry.deals).toEqual([])              // off-sale reflected — good data is NOT kept here
        expect(entry.historicalLow).not.toBeNull()   // all-time low persists (independent of current sale)
        expect(entry.fetchedAt).not.toBe('2026-01-01T00:00:00Z') // freshly stamped — it's a real update
    })

    it('TRANSIENT FAILURE: a failed batch keeps the cached deals and does not re-stamp', async () => {
        const { syncGames } = await import('../../lib/server/relay/itad/itad.service.js')
        await seed()
        await syncGames([{ appid: 220, name: 'Half-Life 2' }], { force: true, fetchFn: stubFetch({ fail: true }) })
        const entry = await readEntry()
        expect(entry.deals).toHaveLength(1)          // cached deals preserved
        expect(entry.deals[0].price).toBe(4.99)
        expect(entry.fetchedAt).toBe('2026-01-01T00:00:00Z') // NOT re-stamped — next sync retries
    })
})
