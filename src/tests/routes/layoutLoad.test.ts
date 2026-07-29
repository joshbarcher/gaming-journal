import { describe, it, beforeEach, afterEach, beforeAll, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { load } from '../../routes/+layout.server.js'
import * as layoutUniversal from '../../routes/+layout.js'
import { setFlag } from '../../lib/server/services/flagsService.js'
import { getJournalService } from '../../lib/server/services/journalService.js'
import { getFranchiseService } from '../../lib/server/services/franchiseService.js'
import { _resetForTests as resetAlertsCache } from '../../lib/server/services/alertsService.js'

// ── Service plumbing ────────────────────────────────────────────────────────
//
// The layout load reads five relay data sources, plus per-appid game/itad reads
// from alertsService when alert flags exist. These used to be loopback HTTP calls
// to the app's own /relay/api/* routes and were stubbed here through global fetch.
// They are now direct in-process service calls (see lib/server/ssrData.ts — the
// round-trip was pure overhead on the render path and its pooled socket going
// stale was the post-idle stall), so the stubs mock the SERVICES instead. The
// behavioural assertions below are unchanged: what matters is that the layout
// degrades to a renderable shape when a source fails, however it is reached.
//
// flags persist under DATA_DIR (path-keyed store cache → fresh tmp dir per test =
// fresh flags). journal/franchise services are process-lifetime singletons pinned
// to the FIRST DATA_DIR they see; in production hooks.server.ts loads them at
// startup, which we mirror in beforeAll below — except for the
// initialization-hazard test that must run before that.

vi.mock('../../lib/server/relay/account/account.service.js', () => ({
    get:         vi.fn(() => null),
    ensureBuilt: vi.fn(async () => {}),
}))
vi.mock('../../lib/server/relay/steam/play-log.service.js', () => ({
    load:              vi.fn(async () => {}),
    getLastPlayedMap:  vi.fn(() => null),
}))
vi.mock('../../lib/server/relay/steam/now-playing.service.js', () => ({
    get: vi.fn(() => null),
}))
vi.mock('../../lib/server/relay/pin/pin.service.js', () => ({
    get: vi.fn(() => null),
}))
vi.mock('../../lib/server/relay/progress-suggest/suggest-job-queue.js', () => ({
    getJobs: vi.fn(() => null),
}))
vi.mock('../../lib/server/relay/games/games.service.js', () => ({
    getOne:      vi.fn(() => null),
    ensureBuilt: vi.fn(async () => {}),
}))
vi.mock('../../lib/server/relay/itad/itad.service.js', () => ({
    getEntry: vi.fn(async () => null),
}))

import * as accountService    from '../../lib/server/relay/account/account.service.js'
import * as playLogService    from '../../lib/server/relay/steam/play-log.service.js'
import * as nowPlayingService from '../../lib/server/relay/steam/now-playing.service.js'
import * as pinService        from '../../lib/server/relay/pin/pin.service.js'
import * as jobQueue          from '../../lib/server/relay/progress-suggest/suggest-job-queue.js'
import * as gamesService      from '../../lib/server/relay/games/games.service.js'
import * as itadService       from '../../lib/server/relay/itad/itad.service.js'

const NETWORK  = Symbol('network-error')
const BAD_JSON = Symbol('bad-json')
const NO_CONTENT = Symbol('http-204')

type Stub = unknown | typeof NETWORK | typeof BAD_JSON | typeof NO_CONTENT

// NETWORK / BAD_JSON both modelled as "the read threw" — the failure the loader
// has to absorb. NO_CONTENT (the relay's 204 "nothing pinned") is the service
// returning null. All three must degrade to null, never reject the load.
function valueOf(v: Stub): unknown {
    if (v === NETWORK || v === BAD_JSON) throw new TypeError('relay read failed')
    if (v === NO_CONTENT) return null
    return v
}

interface LayoutStubs {
    account?:    Stub
    playtime?:   Stub
    nowPlaying?: Stub
    pin?:        Stub
    jobs?:       Stub
    games?:      Record<string, Stub>
    itad?:       Record<string, Stub>
}

function stubRelay(cfg: LayoutStubs = {}) {
    // Module mocks live for the whole file, so call history accumulates across
    // tests — clear it so "was never looked up" assertions mean this test.
    vi.clearAllMocks()
    vi.mocked(accountService.get).mockImplementation(() => valueOf(cfg.account ?? null) as never)
    vi.mocked(accountService.ensureBuilt).mockImplementation(async () => {})
    vi.mocked(playLogService.load).mockImplementation(async () => {})
    vi.mocked(playLogService.getLastPlayedMap).mockImplementation(() => valueOf(cfg.playtime ?? null) as never)
    vi.mocked(nowPlayingService.get).mockImplementation(() => valueOf(cfg.nowPlaying ?? null) as never)
    vi.mocked(pinService.get).mockImplementation(() => valueOf(cfg.pin ?? null) as never)
    vi.mocked(jobQueue.getJobs).mockImplementation(() => valueOf(cfg.jobs ?? null) as never)
    vi.mocked(gamesService.ensureBuilt).mockImplementation(async () => {})
    vi.mocked(gamesService.getOne).mockImplementation(
        ((appid: number) => valueOf(cfg.games?.[String(appid)] ?? null)) as never
    )
    vi.mocked(itadService.getEntry).mockImplementation(
        (async (appid: number) => valueOf(cfg.itad?.[String(appid)] ?? null)) as never
    )
}

function relayDown() {
    vi.clearAllMocks()
    const boom = () => { throw new TypeError('relay read failed') }
    vi.mocked(accountService.get).mockImplementation(boom as never)
    vi.mocked(accountService.ensureBuilt).mockImplementation(boom as never)
    vi.mocked(playLogService.load).mockImplementation(boom as never)
    vi.mocked(playLogService.getLastPlayedMap).mockImplementation(boom as never)
    vi.mocked(nowPlayingService.get).mockImplementation(boom as never)
    vi.mocked(pinService.get).mockImplementation(boom as never)
    vi.mocked(jobQueue.getJobs).mockImplementation(boom as never)
    vi.mocked(gamesService.getOne).mockImplementation(boom as never)
    vi.mocked(gamesService.ensureBuilt).mockImplementation(boom as never)
    vi.mocked(itadService.getEntry).mockImplementation(boom as never)
}

function minutesAgoIso(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString()
}

function tmpDataDir() {
    return path.join(os.tmpdir(), `layout-load-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('+layout.ts (universal)', () => {
    it('disables SSR and exports nothing else load-bearing', () => {
        expect(layoutUniversal.ssr).toBe(false)
        expect('load' in layoutUniversal).toBe(false)
    })
})

describe('+layout.server load', () => {
    let dataDir: string
    let savedDataDir: string | undefined
    let savedRelayUrl: string | undefined

    beforeEach(() => {
        savedDataDir  = process.env.DATA_DIR
        savedRelayUrl = process.env.RELAY_URL
        dataDir = tmpDataDir()
        process.env.DATA_DIR  = dataDir
        process.env.RELAY_URL = 'http://relay.test'
        // Alert rows are memoized per appid for the process lifetime, so without
        // this a previous test's prices leak into the next one's assertions.
        resetAlertsCache()
    })

    afterEach(async () => {
        vi.unstubAllGlobals()
        if (savedDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = savedDataDir
        if (savedRelayUrl === undefined) delete process.env.RELAY_URL
        else process.env.RELAY_URL = savedRelayUrl
        await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
    })

    // Must run BEFORE the beforeAll below initializes the journal/franchise
    // singletons — it exercises the never-initialized state.
    describe('service initialization hazard', () => {
        // REGRESSION: +layout.server once evaluated getJournalService().getAll()
        // synchronously while building the Promise.allSettled arg array, so an
        // uninitialized journal service threw BEFORE allSettled could capture it and
        // the whole layout rejected (every page 500'd). The call is now wrapped in an
        // async thunk, so it degrades to empty pages like every other source.
        it('a journal service that is not initialized must degrade to empty pages, not reject the whole layout', async () => {
            relayDown()
            const data = await load()
            expect(data.pages).toEqual([])
            expect(data.counts.favorites).toBe(0)
        })
    })

    describe('with initialized services (mirrors hooks.server.ts startup)', () => {
        beforeAll(async () => {
            // beforeAll runs BEFORE the per-test beforeEach env swap, and vite.config
            // injects the real .env DATA_DIR — pin the singletons to a throwaway dir
            // explicitly so they never read (or later write) the user's real data.
            // load() is idempotent; missing files fall back to empty defaults.
            const prev = process.env.DATA_DIR
            process.env.DATA_DIR = tmpDataDir()
            try {
                await getJournalService().load()
                await getFranchiseService().load()
            } finally {
                if (prev === undefined) delete process.env.DATA_DIR
                else process.env.DATA_DIR = prev
            }
        })

        describe('relay failure modes', () => {
            it('relay fully down still yields a complete renderable shape', async () => {
                relayDown()
                const data = await load()
                expect(data.counts).toEqual({ favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, playlist: 0, library: 0, wishlist: 0, franchises: 0 })
                expect(data.pages).toEqual([])
                expect(data.alertsCount).toBe(0)
                expect(data.saleAlerts).toEqual([])
                expect(data.historyAppid).toBeNull()
                expect(data.lastPlayed).toBeNull()
                expect(data.nowPlaying).toBeNull()
                expect(data.pin).toBeNull()
                expect(data.trackerJobs).toEqual([])
            })

            it('a failing read on any source degrades to null instead of rejecting the load', async () => {
                // ssrRead catches per-source, so one unavailable service costs its own
                // card and nothing else — it must never 500 the whole page.
                stubRelay({ account: BAD_JSON, playtime: BAD_JSON, nowPlaying: BAD_JSON, pin: BAD_JSON, jobs: BAD_JSON })
                const data = await load()
                expect(data.counts.library).toBe(0)
                expect(data.nowPlaying).toBeNull()
                expect(data.pin).toBeNull()
                expect(data.trackerJobs).toEqual([])
            })

            it('a 204 from the relay is treated as null, never parsed', async () => {
                stubRelay({ pin: NO_CONTENT, nowPlaying: NO_CONTENT })
                const data = await load()
                expect(data.pin).toBeNull()
                expect(data.nowPlaying).toBeNull()
            })
        })

        describe('collection counts', () => {
            it('tallies flag-based counts and reads library/wishlist from account stats', async () => {
                await setFlag(1, 'favorite', true)
                await setFlag(2, 'favorite', true)
                await setFlag(2, 'inProgress', true)   // one game, two counters
                await setFlag(3, 'backlog', true)
                await setFlag(4, 'dropped', true)
                await setFlag(5, 'completed', true)
                await setFlag(6, 'playlist', true)
                stubRelay({ account: { stats: { totalGames: 42, wishlistCount: 7 } } })
                const data = await load()
                expect(data.counts).toEqual({ favorites: 2, inProgress: 1, backlog: 1, dropped: 1, completed: 1, playlist: 1, library: 42, wishlist: 7, franchises: 0 })
            })

            it('an account payload without stats degrades counts to zero', async () => {
                stubRelay({ account: { profile: { name: 'someone' } } })
                const data = await load()
                expect(data.counts.library).toBe(0)
                expect(data.counts.wishlist).toBe(0)
            })
        })

        describe('tracker jobs', () => {
            it('a non-array jobs payload (relay error object) is coerced to an empty array', async () => {
                stubRelay({ jobs: { error: 'queue unavailable' } })
                const data = await load()
                expect(data.trackerJobs).toEqual([])
            })

            it('a valid jobs array passes through', async () => {
                const jobs = [{ id: 'j1', status: 'running' }]
                stubRelay({ jobs })
                const data = await load()
                expect(data.trackerJobs).toEqual(jobs)
            })
        })

        describe('now playing / elapsed', () => {
            it('computes elapsed server-side from sessionStartedAt (h + m form)', async () => {
                stubRelay({ nowPlaying: { playing: { appid: 10, name: 'X', sessionStartedAt: minutesAgoIso(90.5) } } })
                const data = await load()
                expect(data.nowPlaying).toMatchObject({ appid: 10, name: 'X', elapsed: '1h 30m' })
            })

            it('renders whole hours without a minutes suffix', async () => {
                stubRelay({ nowPlaying: { playing: { appid: 10, name: 'X', sessionStartedAt: minutesAgoIso(60.5) } } })
                const data = await load()
                expect(data.nowPlaying?.elapsed).toBe('1h')
            })

            it('clamps a sub-minute session to 1m, never 0m', async () => {
                stubRelay({ nowPlaying: { playing: { appid: 10, name: 'X', sessionStartedAt: minutesAgoIso(0.1) } } })
                const data = await load()
                expect(data.nowPlaying?.elapsed).toBe('1m')
            })

            it('a sessionStartedAt in the FUTURE (clock skew) clamps to 1m instead of going negative', async () => {
                stubRelay({ nowPlaying: { playing: { appid: 10, name: 'X', sessionStartedAt: minutesAgoIso(-5) } } })
                const data = await load()
                expect(data.nowPlaying?.elapsed).toBe('1m')
            })

            it('a null sessionStartedAt yields an empty elapsed string', async () => {
                stubRelay({ nowPlaying: { playing: { appid: 10, name: 'X', sessionStartedAt: null } } })
                const data = await load()
                expect(data.nowPlaying?.elapsed).toBe('')
            })

            it('no active session → nowPlaying null', async () => {
                stubRelay({ nowPlaying: { playing: null } })
                const data = await load()
                expect(data.nowPlaying).toBeNull()
            })
        })

        describe('history / last played', () => {
            it('picks the most recently played appid and resolves its name', async () => {
                stubRelay({
                    playtime: {
                        '100': { lastPlayedAt: minutesAgoIso(600) },
                        '200': { lastPlayedAt: minutesAgoIso(5) },
                        '300': {},                                       // never played — filtered out
                    },
                    games: { '200': { name: 'Freshest Game' } },
                })
                const data = await load()
                expect(data.historyAppid).toBe(200)
                expect(data.lastPlayed).toEqual({ appid: 200, name: 'Freshest Game' })
            })

            it('keeps historyAppid even when the game-name lookup fails mid-request', async () => {
                stubRelay({
                    playtime: { '200': { lastPlayedAt: minutesAgoIso(5) } },
                    games: { '200': NETWORK },
                })
                const data = await load()
                expect(data.historyAppid).toBe(200)
                expect(data.lastPlayed).toBeNull()
            })

            it('survives invalid lastPlayedAt date strings without crashing', async () => {
                stubRelay({
                    playtime: {
                        '100': { lastPlayedAt: 'not-a-date' },
                        '200': { lastPlayedAt: minutesAgoIso(5) },
                    },
                })
                const data = await load()
                expect([100, 200]).toContain(data.historyAppid)   // NaN comparator → order unspecified, but no throw
            })

            it('an empty playtime map yields no history', async () => {
                stubRelay({ playtime: {} })
                const data = await load()
                expect(data.historyAppid).toBeNull()
                expect(data.lastPlayed).toBeNull()
            })
        })

        describe('sale alerts', () => {
            it('maps on-sale alert-flagged games into saleAlerts and drops zero-cut and library entries', async () => {
                await setFlag(111, 'alert', true)   // wishlist, on sale — should appear
                await setFlag(222, 'alert', true)   // wishlist, no deal — watching only
                await setFlag(333, 'alert', true)   // library — excluded from onSale entirely
                stubRelay({
                    games: {
                        '111': { name: 'Deal Game', source: 'wishlist' },
                        '222': { name: 'Full Price', source: 'wishlist' },
                        '333': { name: 'Owned', source: 'library' },
                    },
                    itad: {
                        '111': { deals: [{ price: 5, cut: 50, store: 'Steam' }] },
                        '222': { deals: [] },
                        '333': { deals: [{ price: 1, cut: 90, store: 'Steam' }] },
                    },
                })
                const data = await load()
                expect(data.alertsCount).toBe(1)
                expect(data.saleAlerts).toEqual([{ appid: 111, cut: 50 }])
            })

            it('no alert flags → zero alerts without any price lookups', async () => {
                stubRelay({})
                const data = await load()
                expect(data.alertsCount).toBe(0)
                expect(data.saleAlerts).toEqual([])
                expect(vi.mocked(itadService.getEntry)).not.toHaveBeenCalled()
            })
        })

        describe('pin passthrough', () => {
            it('a pin payload passes through untouched; relay-down pin is null', async () => {
                const pin = { appid: 5, name: 'Pinned', pinnedAt: 't', reason: 'playing', sessionEndedAt: null, postsAccumulated: 0, lastRefreshedAt: null, expiresAt: 't2' }
                stubRelay({ pin })
                expect((await load()).pin).toEqual(pin)
            })
        })
    })
})
