import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { getAlerts, _resetForTests } from '../lib/server/services/alertsService.js'
import { setFlag } from '../lib/server/services/flagsService.js'

// alertsService runs in the ROOT layout, so it runs on every page. It used to make
// two loopback HTTP calls per alerted game; it now reads the games + itad services
// in-process and memoizes each row stale-while-revalidate (see the service header).
// So these mock the services rather than global fetch, and the memo is reset per
// test since it is module-level state.
vi.mock('../lib/server/relay/games/games.service.js', () => ({
    getOne:      vi.fn(() => null),
    ensureBuilt: vi.fn(async () => {}),
}))
vi.mock('../lib/server/relay/itad/itad.service.js', () => ({
    getEntry: vi.fn(async () => null),
}))

import * as gamesService from '../lib/server/relay/games/games.service.js'
import * as itadService  from '../lib/server/relay/itad/itad.service.js'

function makeTmpDir() {
    return path.join(os.tmpdir(), `alerts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('alertsService', () => {
    let tmpDir: string
    let flagsPath: string
    let prevDataDir: string | undefined

    async function writeFlags(store: Record<string, Record<string, unknown>>) {
        await fsp.writeFile(flagsPath, JSON.stringify(store))
    }

    /** Point the mocked services at fixture data, keyed by appid. Anything not
     *  listed reads as "not cached" (null) — the services' own miss behaviour. */
    function relay(games: Record<string, unknown>, itad: Record<string, unknown>) {
        vi.mocked(gamesService.getOne).mockImplementation(
            ((appid: number) => games[String(appid)] ?? null) as never
        )
        vi.mocked(itadService.getEntry).mockImplementation(
            (async (appid: number) => itad[String(appid)] ?? null) as never
        )
    }

    beforeEach(async () => {
        vi.clearAllMocks()
        _resetForTests()
        tmpDir = makeTmpDir()
        await fsp.mkdir(path.join(tmpDir, 'gaming-journal'), { recursive: true })
        flagsPath = path.join(tmpDir, 'gaming-journal', 'flags.json')
        prevDataDir = process.env.DATA_DIR
        process.env.DATA_DIR = tmpDir
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(async () => {
        vi.restoreAllMocks()
        if (prevDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = prevDataDir
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    })

    describe('no alert flags', () => {
        it('returns empty lists and never reads a game or price when the flags file is missing', async () => {
            expect(await getAlerts()).toEqual({ onSale: [], watching: [] })
            expect(vi.mocked(gamesService.getOne)).not.toHaveBeenCalled()
            expect(vi.mocked(itadService.getEntry)).not.toHaveBeenCalled()
        })

        it('ignores appids whose flags do not include alert', async () => {
            await writeFlags({ '1': { favorite: true }, '2': { backlog: true } })
            expect(await getAlerts()).toEqual({ onSale: [], watching: [] })
            expect(vi.mocked(itadService.getEntry)).not.toHaveBeenCalled()
        })

        it('contract: alert:false on disk is treated as no alert', async () => {
            await writeFlags({ '1': { alert: false } })
            expect(await getAlerts()).toEqual({ onSale: [], watching: [] })
            expect(vi.mocked(itadService.getEntry)).not.toHaveBeenCalled()
        })
    })

    describe('service reads', () => {
        it('reads the game and its prices for each alert appid', async () => {
            await writeFlags({ '123': { alert: true } })
            await getAlerts()
            expect(vi.mocked(gamesService.getOne)).toHaveBeenCalledWith(123)
            expect(vi.mocked(itadService.getEntry)).toHaveBeenCalledWith(123)
        })

        it('waits for the games cache before reading it, so a cold process is not a miss', async () => {
            await writeFlags({ '123': { alert: true } })
            await getAlerts()
            expect(vi.mocked(gamesService.ensureBuilt)).toHaveBeenCalled()
        })
    })

    describe('memoization', () => {
        it('a second call inside the TTL serves the memo instead of re-reading', async () => {
            await writeFlags({ '10': { alert: true } })
            relay({ '10': { name: 'Deep Rock', source: 'wishlist' } }, { '10': { deals: [] } })

            const first = await getAlerts()
            const readsAfterFirst = vi.mocked(itadService.getEntry).mock.calls.length
            const second = await getAlerts()

            expect(second).toEqual(first)
            expect(vi.mocked(itadService.getEntry).mock.calls.length).toBe(readsAfterFirst)
        })

        // Mutations go through setFlag, not writeFlags: the flags store is an
        // in-memory ManagedFile, so rewriting the file underneath it is not seen.
        it('a newly alerted game is read on the next call rather than waiting for a refresh', async () => {
            relay({ '10': { name: 'A', source: 'wishlist' }, '20': { name: 'B', source: 'wishlist' } }, {})
            await setFlag(10, 'alert', true)
            await getAlerts()

            await setFlag(20, 'alert', true)
            const result = await getAlerts()

            expect(vi.mocked(itadService.getEntry)).toHaveBeenCalledWith(20)
            expect(result.watching.map(r => r.appid).sort((a, b) => a - b)).toEqual([10, 20])
        })

        it('rows for games no longer alerted are dropped from the memo', async () => {
            relay({ '10': { name: 'A', source: 'wishlist' }, '20': { name: 'B', source: 'wishlist' } }, {})
            await setFlag(10, 'alert', true)
            await setFlag(20, 'alert', true)
            await getAlerts()

            await setFlag(20, 'alert', false)
            const result = await getAlerts()
            expect(result.watching.map(r => r.appid)).toEqual([10])
        })
    })

    describe('read failures', () => {
        it('a failing read on both sources degrades to a watching entry with fallbacks', async () => {
            await writeFlags({ '123': { alert: true } })
            vi.mocked(gamesService.getOne).mockImplementation((() => { throw new Error('ECONNREFUSED') }) as never)
            vi.mocked(itadService.getEntry).mockImplementation((async () => { throw new Error('ECONNREFUSED') }) as never)
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

        it('an uncached game/price (null) degrades the same way', async () => {
            await writeFlags({ '123': { alert: true } })
            relay({}, {})
            const result = await getAlerts()
            expect(result.watching[0].name).toBe('App 123')
            expect(result.watching[0].bestPrice).toBeNull()
        })

        // REGRESSION: one unreadable source must not empty the whole sidebar — the
        // per-appid reads are independent and a throw is absorbed per row.
        it('one game failing must not reject the whole getAlerts call', async () => {
            await writeFlags({ '10': { alert: true }, '20': { alert: true } })
            vi.mocked(gamesService.getOne).mockImplementation(((appid: number) => {
                if (appid === 10) throw new Error('boom')
                return { name: 'Fine', source: 'wishlist' }
            }) as never)
            const result = await getAlerts()
            expect(result.watching.length).toBe(2)
            expect(result.watching.map(r => r.name).sort()).toEqual(['App 10', 'Fine'])
        })
    })

    describe('classification — onSale vs watching', () => {
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

        // REGRESSION: same non-exhaustive classification — a NaN cut once dropped the
        // game from BOTH lists; watching is now the exact complement of onSale.
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

        it('multiple alert flags fan out one game+price read each', async () => {
            await writeFlags({ '1': { alert: true }, '2': { alert: true } })
            await getAlerts()
            expect(vi.mocked(gamesService.getOne)).toHaveBeenCalledTimes(2)
            expect(vi.mocked(itadService.getEntry)).toHaveBeenCalledTimes(2)
        })
    })
})
