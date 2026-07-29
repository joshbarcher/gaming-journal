import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

// The landing-page payload is stale-while-revalidate: assembling it walks the
// guides tree on the NAS, so it must never be rebuilt on the request path. These
// tests pin that contract — the previous behaviour (cache for 60s, then rebuild
// INLINE on the next request) is exactly the post-idle stall this replaced.
//
// The payload's inputs are all mocked; what is under test is the caching, not the
// shaping. getGuideCard is the slow dependency, so it doubles as the lever for
// "a rebuild is in flight".

vi.mock('../../../lib/server/relay/games/games.service.js', () => ({
    getAll:      vi.fn(() => []),
    ensureBuilt: vi.fn(async () => {}),
}))
vi.mock('../../../lib/server/relay/steam/play-log.service.js', () => ({
    getLastPlayedMap: vi.fn(() => ({})),
    getSessions:      vi.fn(() => ({})),
    load:             vi.fn(async () => {}),
}))
vi.mock('../../../lib/server/relay/steam/steam.service.js', () => ({
    getAchievements: vi.fn(() => ({})),
}))
vi.mock('../../../lib/server/relay/provision.service.js', () => ({
    getLibraryFirstSeen: vi.fn(() => ({})),
}))
vi.mock('../../../lib/server/relay/steam/upcoming.service.js', () => ({
    get: vi.fn(() => ({ upcoming: [] })),
}))
vi.mock('../../../lib/server/relay/home/guide-card.service.js', () => ({
    getGuideCard: vi.fn(async () => null),
}))

import {
    getHomeData,
    invalidateHomeCache,
    warmHomeCache,
    _resetForTests,
} from '../../../lib/server/relay/home/home.service.js'
import * as gamesService from '../../../lib/server/relay/games/games.service.js'
import * as playLog      from '../../../lib/server/relay/steam/play-log.service.js'
import * as guideCard    from '../../../lib/server/relay/home/guide-card.service.js'

const PAYLOAD_TTL_MS = 60 * 1000   // mirrors home.service

/** One library game, played just now — enough for the payload to be non-degenerate
 *  and for the guide lookup (the slow step) to actually run. */
function seedOneGame() {
    vi.mocked(gamesService.getAll).mockReturnValue([
        { appid: 1, name: 'Game One', source: 'library' },
    ] as never)
    vi.mocked(playLog.getLastPlayedMap).mockReturnValue({
        '1': { lastPlayedAt: new Date().toISOString(), effectiveMin: 120 },
    } as never)
}

/** A guide lookup that blocks until released — lets a test observe the window
 *  where a rebuild is in flight. */
function blockingGuideLookup() {
    let release: (v: unknown) => void = () => {}
    const gate = new Promise((res) => { release = res })
    vi.mocked(guideCard.getGuideCard).mockImplementation((async () => {
        await gate
        return { source: 'ign', guideId: 'g1', title: 'Guide' }
    }) as never)
    return { release: () => release(null) }
}

describe('home payload cache (stale-while-revalidate)', () => {
    let prevDataDir: string | undefined

    // NB: vi.clearAllMocks() only clears call history — an implementation set by one
    // test (e.g. the throwing getLastPlayedMap below) would leak into the next. Every
    // default is re-established explicitly here.
    function resetMocks() {
        vi.clearAllMocks()
        vi.mocked(gamesService.getAll).mockReturnValue([] as never)
        vi.mocked(gamesService.ensureBuilt).mockImplementation(async () => {})
        vi.mocked(playLog.getLastPlayedMap).mockReturnValue({} as never)
        vi.mocked(playLog.getSessions).mockReturnValue({} as never)
        vi.mocked(playLog.load).mockImplementation(async () => {})
        vi.mocked(guideCard.getGuideCard).mockImplementation((async () => null) as never)
    }

    beforeEach(() => {
        resetMocks()
        _resetForTests()
        prevDataDir = process.env.DATA_DIR
        process.env.DATA_DIR = path.join(os.tmpdir(), `home-cache-${Date.now()}`)
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        if (prevDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = prevDataDir
    })

    it('builds on the first call and serves the same payload from memory within the TTL', async () => {
        seedOneGame()
        const first = await getHomeData()
        expect(first.recentPlayed).toHaveLength(1)

        const lookupsAfterFirst = vi.mocked(guideCard.getGuideCard).mock.calls.length
        const second = await getHomeData()

        expect(second).toBe(first)   // same object — not rebuilt
        expect(vi.mocked(guideCard.getGuideCard).mock.calls.length).toBe(lookupsAfterFirst)
    })

    // THE regression this whole change exists for: once the payload went stale the
    // next request used to await a full rebuild (a NAS guides walk), so any pause in
    // browsing longer than the TTL meant seconds of blank cards.
    it('serves the stale payload IMMEDIATELY once the TTL lapses, without waiting for the rebuild', async () => {
        seedOneGame()
        const original = await getHomeData()

        vi.useFakeTimers()
        vi.setSystemTime(Date.now() + PAYLOAD_TTL_MS + 1)

        const { release } = blockingGuideLookup()
        // The rebuild is now blocked on the guide lookup. This must still resolve.
        const served = await getHomeData()
        expect(served).toBe(original)

        release()
    })

    it('picks up the refreshed payload on a later call once the background rebuild lands', async () => {
        seedOneGame()
        const original = await getHomeData()

        vi.useFakeTimers()
        vi.setSystemTime(Date.now() + PAYLOAD_TTL_MS + 1)

        vi.mocked(guideCard.getGuideCard).mockImplementation((async () => ({
            source: 'ign', guideId: 'fresh', title: 'Fresh Guide',
        })) as never)

        const stale = await getHomeData()   // returns old payload, kicks the rebuild
        expect(stale).toBe(original)

        // Back to real timers so waitFor can poll; the rebuild stamps its own
        // (fake, future) timestamp, so the fresh payload stays fresh once promoted.
        vi.useRealTimers()
        await vi.waitFor(async () => {
            const p = await getHomeData()
            expect(p.recentPlayed[0].guide).toMatchObject({ guideId: 'fresh' })
        })
        expect(await getHomeData()).not.toBe(original)
    })

    it('collapses a burst of stale requests into ONE rebuild (single-flight)', async () => {
        seedOneGame()
        await getHomeData()

        vi.useFakeTimers()
        vi.setSystemTime(Date.now() + PAYLOAD_TTL_MS + 1)

        const { release } = blockingGuideLookup()
        const lookupsBefore = vi.mocked(guideCard.getGuideCard).mock.calls.length
        await Promise.all([getHomeData(), getHomeData(), getHomeData(), getHomeData()])
        release()

        // Four stale reads → one rebuild → one guide lookup for the seeded game.
        expect(vi.mocked(guideCard.getGuideCard).mock.calls.length).toBe(lookupsBefore + 1)
    })

    // "It's fine to render the last known good data. Blanking while waiting for data
    // is terrible UX" — a failed rebuild must never surface as an empty page.
    it('keeps serving the last-known-good payload when a rebuild fails', async () => {
        seedOneGame()
        const original = await getHomeData()

        vi.useFakeTimers()
        vi.setSystemTime(Date.now() + PAYLOAD_TTL_MS + 1)
        vi.mocked(playLog.getLastPlayedMap).mockImplementation(() => { throw new Error('NAS unavailable') })

        const served = await getHomeData()
        expect(served).toBe(original)
        expect(served.recentPlayed).toHaveLength(1)

        // And again — still the good payload, never null.
        expect(await getHomeData()).toBe(original)
    })

    it('does not promote a degenerate payload built before the games cache is warm', async () => {
        // No games yet: the session/sale cards derive from getAll(), so caching this
        // would blank them until the next expiry.
        vi.mocked(gamesService.getAll).mockReturnValue([] as never)
        const empty = await getHomeData()
        expect(empty.recentPlayed).toEqual([])

        // Games arrive; the very next call must reflect them rather than serving the
        // empty build from cache.
        seedOneGame()
        const warm = await getHomeData()
        expect(warm.recentPlayed).toHaveLength(1)
    })

    it('invalidateHomeCache keeps serving the current payload rather than blanking it', async () => {
        seedOneGame()
        const original = await getHomeData()

        invalidateHomeCache()
        const { release } = blockingGuideLookup()

        // Marked stale, so a refresh is kicked off — but the old cards still render.
        const served = await getHomeData()
        expect(served).toBe(original)
        release()
    })

    it('warmHomeCache builds the payload up front so the first visitor does not', async () => {
        seedOneGame()
        warmHomeCache()

        await vi.waitFor(() => {
            expect(vi.mocked(gamesService.ensureBuilt)).toHaveBeenCalled()
            expect(vi.mocked(guideCard.getGuideCard)).toHaveBeenCalled()
        })

        const lookupsAfterWarm = vi.mocked(guideCard.getGuideCard).mock.calls.length
        const served = await getHomeData()
        expect(served.recentPlayed).toHaveLength(1)
        // Served from the warmed cache — the request rebuilt nothing.
        expect(vi.mocked(guideCard.getGuideCard).mock.calls.length).toBe(lookupsAfterWarm)
    })
})
