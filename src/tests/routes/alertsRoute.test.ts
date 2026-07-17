import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

import { GET as getAlertsRoute } from '../../routes/api/alerts/+server.js'

// Adversarial tests for GET /api/alerts. alertsService reads the flags store
// (DATA_DIR) to find alert-flagged appids, then fans out to the relay
// (/api/games/:id and /api/itad/:id) — global fetch is stubbed, no real relay.

function tmpDataDir() {
    return path.join(os.tmpdir(), `alerts-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

async function writeFlags(dataDir: string, flags: Record<string, unknown>) {
    const p = path.join(dataDir, 'gaming-journal', 'flags.json')
    await fsp.mkdir(path.dirname(p), { recursive: true })
    await fsp.writeFile(p, JSON.stringify(flags))
}

type RelayData = Record<string, unknown> // keyed by URL suffix like '/api/games/10'

function stubRelay(data: RelayData) {
    return vi.fn(async (url: string) => {
        // Strip host AND the journal's /relay prefix (fold-in): calls now target
        // the journal's own /relay/api/* on loopback, keyed by the /api/... suffix.
        const suffix = String(url).replace(/^http:\/\/[^/]+(\/relay)?/, '')
        if (suffix in data) return { ok: true, json: async () => data[suffix] }
        return { ok: false, status: 404, json: async () => ({}) }
    })
}

describe('GET /api/alerts (adversarial)', () => {
    let dataDir: string
    let savedDataDir: string | undefined
    let savedRelayUrl: string | undefined
    let savedPort: string | undefined

    beforeEach(() => {
        savedDataDir  = process.env.DATA_DIR
        savedRelayUrl = process.env.RELAY_URL
        savedPort     = process.env.PORT
        dataDir = tmpDataDir()
        process.env.DATA_DIR  = dataDir
        // Alerts call the journal's own /relay on loopback (fold-in), keyed off
        // PORT, not RELAY_URL. See journalRelayBase.
        process.env.PORT = '1234'
    })

    afterEach(async () => {
        vi.unstubAllGlobals()
        if (savedDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = savedDataDir
        if (savedRelayUrl === undefined) delete process.env.RELAY_URL
        else process.env.RELAY_URL = savedRelayUrl
        if (savedPort === undefined) delete process.env.PORT
        else process.env.PORT = savedPort
        await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
    })

    it('returns empty lists and never touches the relay when no flags exist', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const res = await getAlertsRoute()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ onSale: [], watching: [] })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('ignores games flagged with anything other than alert', async () => {
        await writeFlags(dataDir, { '10': { favorite: true }, '11': { completed: true } })
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const res = await getAlertsRoute()
        expect(await res.json()).toEqual({ onSale: [], watching: [] })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('relay completely down → 200 with the game in watching (placeholder name), NOT a 500', async () => {
        await writeFlags(dataDir, { '10': { alert: true } })
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
        const res = await getAlertsRoute()
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.onSale).toEqual([])
        expect(body.watching).toEqual([{
            appid:         10,
            name:          'App 10',
            bestPrice:     null,
            historicalLow: null,
            isLibrary:     false,
        }])
    })

    it('relay answering non-2xx for everything → same graceful degradation', async () => {
        await writeFlags(dataDir, { '20': { alert: true } })
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
        const res = await getAlertsRoute()
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.watching[0].name).toBe('App 20')
    })

    it('relay returning ok but a body whose json() rejects → treated as null, no crash', async () => {
        await writeFlags(dataDir, { '30': { alert: true } })
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: () => Promise.reject(new SyntaxError('bad json')) })))
        const res = await getAlertsRoute()
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.watching.length).toBe(1)
        expect(body.onSale.length).toBe(0)
    })

    it('a game with a real discount lands in onSale with url defaulted to null', async () => {
        await writeFlags(dataDir, { '40': { alert: true } })
        vi.stubGlobal('fetch', stubRelay({
            '/api/games/40': { name: 'Deal Game', source: 'wishlist' },
            '/api/itad/40':  { deals: [{ price: 9.99, cut: 50, store: 'Steam' }], historicalLow: { price: 4.99 } },
        }))
        const body = await (await getAlertsRoute()).json()
        expect(body.onSale).toEqual([{
            appid:         40,
            name:          'Deal Game',
            bestPrice:     { price: 9.99, cut: 50, store: 'Steam', url: null },
            historicalLow: { price: 4.99 },
            isLibrary:     false,
        }])
        expect(body.watching).toEqual([])
    })

    // Weird cut values must land the game in watching — never vanish from both lists.
    it.each([
        ['cut 0',        { deals: [{ price: 10, cut: 0, store: 's' }] }],
        ['negative cut', { deals: [{ price: 10, cut: -5, store: 's' }] }],
        ['empty deals',  { deals: [] }],
        ['no deals key', {}],
    ])('itad edge — %s → game appears in watching, not onSale', async (_label, itad) => {
        await writeFlags(dataDir, { '50': { alert: true } })
        vi.stubGlobal('fetch', stubRelay({
            '/api/games/50': { name: 'Edge Game', source: 'wishlist' },
            '/api/itad/50':  itad,
        }))
        const body = await (await getAlertsRoute()).json()
        expect(body.onSale).toEqual([])
        expect(body.watching.length).toBe(1)
        expect(body.watching[0].name).toBe('Edge Game')
    })

    it('NaN cut → watching (NaN > 0 is false), never lost from both lists', async () => {
        await writeFlags(dataDir, { '51': { alert: true } })
        vi.stubGlobal('fetch', stubRelay({
            '/api/games/51': { name: 'NaN Game' },
            // JSON can't carry NaN, but the relay could send a non-numeric string.
            '/api/itad/51':  { deals: [{ price: 10, cut: 'not-a-number', store: 's' }] },
        }))
        const body = await (await getAlertsRoute()).json()
        expect(body.onSale).toEqual([])
        expect(body.watching.length).toBe(1)
    })

    // Contract: library-owned games are intentionally excluded from BOTH lists,
    // even when they are on sale (you already own them).
    it('a library game on sale appears in neither list', async () => {
        await writeFlags(dataDir, { '60': { alert: true } })
        vi.stubGlobal('fetch', stubRelay({
            '/api/games/60': { name: 'Owned Game', source: 'library' },
            '/api/itad/60':  { deals: [{ price: 1, cut: 90, store: 's' }] },
        }))
        const body = await (await getAlertsRoute()).json()
        expect(body.onSale).toEqual([])
        expect(body.watching).toEqual([])
    })

    it('source "both" is also treated as library-owned', async () => {
        await writeFlags(dataDir, { '61': { alert: true } })
        vi.stubGlobal('fetch', stubRelay({
            '/api/games/61': { name: 'Both Game', source: 'both' },
            '/api/itad/61':  {},
        }))
        const body = await (await getAlertsRoute()).json()
        expect(body.onSale).toEqual([])
        expect(body.watching).toEqual([])
    })

    it('onSale is sorted by cut descending even when the relay answers out of order', async () => {
        await writeFlags(dataDir, { '70': { alert: true }, '71': { alert: true }, '72': { alert: true } })
        vi.stubGlobal('fetch', stubRelay({
            '/api/games/70': { name: 'Small' },
            '/api/itad/70':  { deals: [{ price: 5, cut: 10, store: 's' }] },
            '/api/games/71': { name: 'Big' },
            '/api/itad/71':  { deals: [{ price: 5, cut: 80, store: 's' }] },
            '/api/games/72': { name: 'Mid' },
            '/api/itad/72':  { deals: [{ price: 5, cut: 40, store: 's' }] },
        }))
        const body = await (await getAlertsRoute()).json()
        expect(body.onSale.map((r: { name: string }) => r.name)).toEqual(['Big', 'Mid', 'Small'])
    })

    it('only the FIRST deal is considered the best price (contract: relay pre-sorts)', async () => {
        await writeFlags(dataDir, { '80': { alert: true } })
        vi.stubGlobal('fetch', stubRelay({
            '/api/games/80': { name: 'Multi Deal' },
            '/api/itad/80':  { deals: [
                { price: 20, cut: 10, store: 'first' },
                { price: 1,  cut: 95, store: 'better-but-ignored' },
            ] },
        }))
        const body = await (await getAlertsRoute()).json()
        expect(body.onSale[0].bestPrice.store).toBe('first')
        expect(body.onSale[0].bestPrice.cut).toBe(10)
    })

    // Contract (quirk): a junk flags key like "__proto__" becomes Number() → NaN,
    // the relay is queried for /api/games/NaN, and the JSON response serializes the
    // NaN appid as null. It must not crash or pollute anything — just documented.
    it('a "__proto__" flags key degrades to a NaN appid entry without crashing', async () => {
        // NB: written as a raw string — a JS object literal { '__proto__': ... } would
        // set the prototype instead of creating the key, and stringify to "{}".
        const p = path.join(dataDir, 'gaming-journal', 'flags.json')
        await fsp.mkdir(path.dirname(p), { recursive: true })
        await fsp.writeFile(p, '{"__proto__": {"alert": true}}')
        const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
        vi.stubGlobal('fetch', fetchMock)
        const res = await getAlertsRoute()
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.watching.length).toBe(1)
        expect(body.watching[0].appid).toBeNull() // NaN → null through JSON
        expect(body.watching[0].name).toBe('App NaN')
        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1234/relay/api/games/NaN')
        expect(({} as Record<string, unknown>).alert).toBeUndefined() // no prototype pollution
    })

    it('returns a 500 JSON envelope (not a throw) when DATA_DIR is unset', async () => {
        delete process.env.DATA_DIR
        vi.stubGlobal('fetch', vi.fn())
        const res = await getAlertsRoute()
        expect(res.status).toBe(500)
        expect((await res.json()).error).toMatch(/DATA_DIR/)
    })
})
