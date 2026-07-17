import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { getAlerts } from '../lib/server/services/alertsService.js'

function makeTmpDir() {
    return path.join(os.tmpdir(), `alerts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

type FetchMock = ReturnType<typeof vi.fn>

function ok(data: unknown) {
    return { ok: true, json: async () => data }
}
function notFound() {
    return { ok: false, status: 404, json: async () => ({}) }
}

describe('alertsService', () => {
    let tmpDir: string
    let flagsPath: string
    let prevDataDir: string | undefined
    let prevRelayUrl: string | undefined
    let prevPort: string | undefined
    let fetchMock: FetchMock

    async function writeFlags(store: Record<string, Record<string, unknown>>) {
        await fsp.writeFile(flagsPath, JSON.stringify(store))
    }

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await fsp.mkdir(path.join(tmpDir, 'gaming-journal'), { recursive: true })
        flagsPath = path.join(tmpDir, 'gaming-journal', 'flags.json')
        prevDataDir = process.env.DATA_DIR
        prevRelayUrl = process.env.RELAY_URL
        prevPort = process.env.PORT
        process.env.DATA_DIR = tmpDir
        // Alerts now call the journal's OWN /relay/* on loopback (fold-in), keyed
        // off PORT — not RELAY_URL (the mail-only relay). See journalRelayBase.
        process.env.PORT = '9999'
        fetchMock = vi.fn(async () => notFound())
        vi.stubGlobal('fetch', fetchMock)
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(async () => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        if (prevDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = prevDataDir
        if (prevRelayUrl === undefined) delete process.env.RELAY_URL
        else process.env.RELAY_URL = prevRelayUrl
        if (prevPort === undefined) delete process.env.PORT
        else process.env.PORT = prevPort
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    })

    describe('no alert flags', () => {
        it('returns empty lists and never touches the relay when the flags file is missing', async () => {
            expect(await getAlerts()).toEqual({ onSale: [], watching: [] })
            expect(fetchMock).not.toHaveBeenCalled()
        })

        it('ignores appids whose flags do not include alert', async () => {
            await writeFlags({ '1': { favorite: true }, '2': { backlog: true } })
            expect(await getAlerts()).toEqual({ onSale: [], watching: [] })
            expect(fetchMock).not.toHaveBeenCalled()
        })

        it('contract: alert:false on disk is treated as no alert', async () => {
            await writeFlags({ '1': { alert: false } })
            expect(await getAlerts()).toEqual({ onSale: [], watching: [] })
            expect(fetchMock).not.toHaveBeenCalled()
        })
    })

    describe('URL construction', () => {
        it('fetches game and itad endpoints for each alert appid', async () => {
            await writeFlags({ '123': { alert: true } })
            await getAlerts()
            const urls = fetchMock.mock.calls.map(c => String(c[0])).sort()
            expect(urls).toEqual([
                'http://127.0.0.1:9999/relay/api/games/123',
                'http://127.0.0.1:9999/relay/api/itad/123',
            ])
        })

        it('targets the journal\'s own /relay base, never a double slash', async () => {
            await writeFlags({ '5': { alert: true } })
            await getAlerts()
            const urls = fetchMock.mock.calls.map(c => String(c[0]))
            expect(urls.length).toBeGreaterThan(0)
            for (const u of urls) {
                expect(u).toMatch(/^http:\/\/127\.0\.0\.1:9999\/relay\/api\//)
                expect(u.replace(/^https?:\/\//, '')).not.toContain('//')
            }
        })

        it('defaults to loopback:5173 when PORT is unset', async () => {
            delete process.env.PORT
            await writeFlags({ '5': { alert: true } })
            await getAlerts()
            expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/127\.0\.0\.1:5173\/relay\/api\//)
        })
    })

    describe('relay failures', () => {
        it('network errors on both endpoints degrade to a watching entry with fallbacks', async () => {
            await writeFlags({ '123': { alert: true } })
            fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
            const result = await getAlerts()
            expect(result.onSale).toEqual([])
            expect(result.watching).toEqual([{
                appid:         123,
                name:          'App 123',
                bestPrice:     null,
                historicalLow: null,
                isLibrary:     false,
            }])
        })

        it('non-ok responses degrade the same way', async () => {
            await writeFlags({ '123': { alert: true } })
            fetchMock.mockResolvedValue(notFound())
            const result = await getAlerts()
            expect(result.watching[0].name).toBe('App 123')
            expect(result.watching[0].bestPrice).toBeNull()
        })

        // REGRESSION: fetchJson once did `return res.json()` (no await) inside try/catch,
        // so a rejected json() promise escaped the catch and rejected the whole
        // getAlerts() Promise.all; it now awaits res.json() so a malformed body degrades.
        it('a malformed JSON body from the relay must not reject the whole getAlerts call', async () => {
            await writeFlags({ '123': { alert: true } })
            fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token <')) })
            const result = await getAlerts()
            expect(result.watching.length).toBe(1)
        })
    })

    describe('classification — onSale vs watching', () => {
        function relay(games: Record<string, unknown>, itad: Record<string, unknown>) {
            fetchMock.mockImplementation(async (input: unknown) => {
                const url = String(input)
                let m = url.match(/\/api\/games\/(.+)$/)
                if (m) return games[m[1]] !== undefined ? ok(games[m[1]]) : notFound()
                m = url.match(/\/api\/itad\/(.+)$/)
                if (m) return itad[m[1]] !== undefined ? ok(itad[m[1]]) : notFound()
                return notFound()
            })
        }

        it('a positive cut lands in onSale with the deal mapped to bestPrice', async () => {
            await writeFlags({ '10': { alert: true } })
            relay(
                { '10': { name: 'Deep Rock', source: 'wishlist' } },
                { '10': { deals: [{ price: 9.99, cut: 67, store: 'Steam', url: 'https://s.example/10' }],
                          historicalLow: { price: 7.99, cut: 75, store: 'GOG' } } },
            )
            const result = await getAlerts()
            expect(result.watching).toEqual([])
            expect(result.onSale).toEqual([{
                appid:         10,
                name:          'Deep Rock',
                bestPrice:     { price: 9.99, cut: 67, store: 'Steam', url: 'https://s.example/10' },
                historicalLow: { price: 7.99, cut: 75, store: 'GOG' },
                isLibrary:     false,
            }])
        })

        it('a deal with a missing url maps url to null', async () => {
            await writeFlags({ '10': { alert: true } })
            relay({}, { '10': { deals: [{ price: 1, cut: 50, store: 'Fanatical' }] } })
            const result = await getAlerts()
            expect(result.onSale[0].bestPrice!.url).toBeNull()
        })

        it('cut of exactly 0 lands in watching (boundary)', async () => {
            await writeFlags({ '10': { alert: true } })
            relay({}, { '10': { deals: [{ price: 19.99, cut: 0, store: 'Steam' }] } })
            const result = await getAlerts()
            expect(result.onSale).toEqual([])
            expect(result.watching.length).toBe(1)
        })

        // REGRESSION: classification was once non-exhaustive — onSale required cut > 0
        // and watching required cut === 0, so a negative cut dropped the alerted game
        // from BOTH lists; watching is now the exact complement of onSale.
        it('a negative cut must not make the alerted game vanish from both lists', async () => {
            await writeFlags({ '10': { alert: true } })
            relay({}, { '10': { deals: [{ price: 19.99, cut: -5, store: 'Steam' }] } })
            const result = await getAlerts()
            expect(result.onSale.length + result.watching.length).toBe(1)
        })

        it('an empty deals array degrades to watching with null bestPrice', async () => {
            await writeFlags({ '10': { alert: true } })
            relay({}, { '10': { deals: [] } })
            const result = await getAlerts()
            expect(result.watching[0].bestPrice).toBeNull()
        })

        it('library and "both" games are excluded from both lists even when on sale', async () => {
            await writeFlags({ '1': { alert: true }, '2': { alert: true }, '3': { alert: true } })
            relay(
                {
                    '1': { name: 'Owned',    source: 'library' },
                    '2': { name: 'Both',     source: 'both' },
                    '3': { name: 'Wanted',   source: 'wishlist' },
                },
                {
                    '1': { deals: [{ price: 1, cut: 90, store: 'Steam' }] },
                    '2': { deals: [{ price: 1, cut: 90, store: 'Steam' }] },
                    '3': { deals: [{ price: 1, cut: 90, store: 'Steam' }] },
                },
            )
            const result = await getAlerts()
            expect(result.onSale.map(r => r.appid)).toEqual([3])
            expect(result.watching).toEqual([])
        })

        it('onSale is sorted by cut descending', async () => {
            await writeFlags({ '1': { alert: true }, '2': { alert: true }, '3': { alert: true } })
            relay({}, {
                '1': { deals: [{ price: 5, cut: 10, store: 'A' }] },
                '2': { deals: [{ price: 5, cut: 50, store: 'B' }] },
                '3': { deals: [{ price: 5, cut: 30, store: 'C' }] },
            })
            const result = await getAlerts()
            expect(result.onSale.map(r => r.bestPrice!.cut)).toEqual([50, 30, 10])
        })

        it('contract: only deals[0] is considered, even if a later deal is cheaper', async () => {
            await writeFlags({ '10': { alert: true } })
            relay({}, { '10': { deals: [
                { price: 9.99, cut: 50, store: 'Steam' },
                { price: 4.99, cut: 75, store: 'GOG' },
            ] } })
            const result = await getAlerts()
            expect(result.onSale[0].bestPrice!.store).toBe('Steam')
            expect(result.onSale[0].bestPrice!.cut).toBe(50)
        })

        // REGRESSION: same non-exhaustive classification — a NaN cut (relay garbage;
        // in-process the deal carries a real NaN) once dropped the game from BOTH lists;
        // watching is now the exact complement of onSale, so a NaN cut lands in watching.
        it('a NaN cut must not make the alerted game vanish from both lists', async () => {
            await writeFlags({ '10': { alert: true } })
            relay({}, { '10': { deals: [{ price: 5, cut: NaN, store: 'A' }] } })
            const result = await getAlerts()
            expect(result.onSale.length + result.watching.length).toBe(1)
        })
    })

    describe('flag-store edge cases', () => {
        it('contract: a non-numeric appid key becomes NaN but does not crash', async () => {
            await writeFlags({ 'not-a-number': { alert: true } })
            const result = await getAlerts()
            expect(result.watching.length).toBe(1)
            expect(Number.isNaN(result.watching[0].appid)).toBe(true)
            expect(result.watching[0].name).toBe('App NaN')
        })

        it('multiple alert flags fan out one game+itad fetch pair each', async () => {
            await writeFlags({ '1': { alert: true }, '2': { alert: true } })
            await getAlerts()
            expect(fetchMock).toHaveBeenCalledTimes(4)
        })
    })
})
