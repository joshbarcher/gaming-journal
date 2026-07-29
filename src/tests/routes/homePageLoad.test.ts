import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { load } from '../../routes/+page.server.js'
import { setFlag } from '../../lib/server/services/flagsService.js'
import { patchSettings } from '../../lib/server/services/settingsService.js'
import type { DiscoverItem, DiscoverSection } from '../../lib/types.js'

// ── Fixtures / plumbing ─────────────────────────────────────────────────────
//
// load() reads the home payload and the two poster batches IN-PROCESS now (see
// lib/server/ssrData.ts — the loopback round-trip was overhead on the render path
// and its stale pooled socket was the post-idle stall), so those are mocked as
// services. /api/discover/featured is NOT a thin service delegate (adult
// annotation, path rewriting, background image caching) so it stays behind its
// route and is still stubbed through fetch. flags/settings persist through
// DATA_DIR-keyed store files, so a fresh tmp dir per test gives fresh service
// state (same pattern as localReviewsService.test.ts).

vi.mock('../../lib/server/relay/home/home.service.js', () => ({
    getHomeData: vi.fn(async () => null),
}))
vi.mock('../../lib/server/relay/games/games.service.js', () => ({
    ensureBuilt: vi.fn(async () => {}),
}))
vi.mock('../../lib/server/relay/games/poster-pool.service.js', () => ({
    getPosterBatch: vi.fn(() => []),
}))
vi.mock('../../lib/server/relay/steam/play-log.service.js', () => ({
    load: vi.fn(async () => {}),
}))

import * as homeService  from '../../lib/server/relay/home/home.service.js'
import * as gamesService from '../../lib/server/relay/games/games.service.js'
import * as posterPool   from '../../lib/server/relay/games/poster-pool.service.js'

const NETWORK  = Symbol('network-error')   // the read rejects
const HTTP_500 = Symbol('http-500')        // non-ok response
const BAD_JSON = Symbol('bad-json')        // ok response, body fails to parse

type Stub = unknown | typeof NETWORK | typeof HTTP_500 | typeof BAD_JSON

function respond(v: Stub) {
    if (v === NETWORK)  throw new TypeError('fetch failed')
    if (v === HTTP_500) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
    if (v === BAD_JSON) return { ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) }
    return { ok: true, status: 200, json: async () => v }
}

// All three sentinels mean the same thing to an in-process read: it threw, and the
// loader must degrade that source to null rather than reject the page.
function serve(v: Stub): unknown {
    if (v === NETWORK || v === HTTP_500 || v === BAD_JSON) throw new TypeError('read failed')
    return v
}

interface RelayStubs { home?: Stub; lib?: Stub; wl?: Stub; discover?: Stub }

function stubRelay({ home = null, lib = [], wl = [], discover = [] }: RelayStubs = {}) {
    vi.clearAllMocks()
    vi.mocked(homeService.getHomeData).mockImplementation((async () => serve(home)) as never)
    vi.mocked(gamesService.ensureBuilt).mockImplementation(async () => {})
    vi.mocked(posterPool.getPosterBatch).mockImplementation(
        ((source: string) => serve(source === 'wishlist' ? wl : lib)) as never
    )
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.includes('/api/discover/featured')) return respond(discover)
        return { ok: false, status: 404, json: async () => null }
    }))
}

function relayDown() {
    vi.clearAllMocks()
    const boom = () => { throw new TypeError('read failed') }
    vi.mocked(homeService.getHomeData).mockImplementation(boom as never)
    vi.mocked(posterPool.getPosterBatch).mockImplementation(boom as never)
    vi.mocked(gamesService.ensureBuilt).mockImplementation(async () => {})
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))))
}

const STATS = { hours: 12, achievements: 34, added: 5, wishlisted: 6, ratings: 7 }

function homePayload(over: Record<string, unknown> = {}) {
    return { recentPlayed: [], justBought: [], stats: STATS, release: null, libPosters: [], wlPosters: [], ...over }
}

function played(appid: number, over: Record<string, unknown> = {}) {
    return { appid, name: `Game ${appid}`, header: `hdr-${appid}`, hours: 1, daysAgo: 0, achievements: null, ...over }
}

function bought(appid: number) {
    return { appid, name: `Bought ${appid}`, header: `hdr-${appid}`, daysAgo: 2 }
}

const GUIDE = { source: 'ign', guideId: 'g1', title: 'Guide', sourceUrl: null, pageCount: 3, screenshot: null, screenshots: [] }

function discoverSection(items: Partial<DiscoverItem>[]): DiscoverSection {
    return { id: 'sec', page: 1, pages: 1, items: items as DiscoverItem[] }
}

function discItem(appid: number, over: Partial<DiscoverItem> = {}): Partial<DiscoverItem> {
    return { appid, name: `Disc ${appid}`, headerImage: `img-${appid}`, ...over }
}

function tmpDataDir() {
    return path.join(os.tmpdir(), `home-load-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('home +page.server load', () => {
    let dataDir: string
    let savedDataDir: string | undefined
    let savedRelayUrl: string | undefined

    beforeEach(() => {
        savedDataDir  = process.env.DATA_DIR
        savedRelayUrl = process.env.RELAY_URL
        dataDir = tmpDataDir()
        process.env.DATA_DIR  = dataDir
        process.env.RELAY_URL = 'http://relay.test'
    })

    afterEach(async () => {
        vi.unstubAllGlobals()
        if (savedDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = savedDataDir
        if (savedRelayUrl === undefined) delete process.env.RELAY_URL
        else process.env.RELAY_URL = savedRelayUrl
        await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
    })

    // ── Relay failure modes ─────────────────────────────────────────────────

    describe('relay failure modes', () => {
        it('relay fully down (fetch rejects) still returns renderable defaults', async () => {
            relayDown()
            const data = await load()
            expect(data.session).toBeNull()
            expect(data.middle).toEqual({ kind: 'stats', hours: 0, achievements: 0, ratings: 0, added: 0, wishlisted: 0 })
            expect(data.libPosters).toEqual([])
            expect(data.wlPosters).toEqual([])
            expect(data.discPosters).toEqual([])
        })

        it('relay returning HTTP 500 on every endpoint degrades to the same defaults', async () => {
            stubRelay({ home: HTTP_500, lib: HTTP_500, wl: HTTP_500, discover: HTTP_500 })
            const data = await load()
            expect(data.session).toBeNull()
            expect(data.middle.kind).toBe('stats')
            expect(data.libPosters).toEqual([])
            expect(data.wlPosters).toEqual([])
            expect(data.discPosters).toEqual([])
        })

        // REGRESSION: fetchJson once returned res.json() un-awaited inside the try, so
        // a 200 body that failed to parse rejected outside the catch, propagated through
        // Promise.all, and 500'd the whole home page. The json() is now awaited inside
        // the try, so a bad body degrades to defaults.
        it('a 200 response with a malformed body must degrade to defaults, not reject the whole load', async () => {
            stubRelay({ home: BAD_JSON })
            const data = await load()
            expect(data.session).toBeNull()
            expect(data.middle.kind).toBe('stats')
        })

        // Same un-awaited json() escape hatch, hit through a poster endpoint: one
        // bad body on a secondary endpoint must not take down the entire page.
        it('a malformed poster response must not reject the load either', async () => {
            stubRelay({ home: homePayload(), lib: BAD_JSON })
            const data = await load()
            expect(data.libPosters).toEqual([])
        })
    })

    // ── Partial / malformed relay payloads ──────────────────────────────────

    describe('partial relay data', () => {
        // REGRESSION: `homeData ?? EMPTY_RELAY` once guarded only null, so a truthy `{}`
        // payload (version skew / partial write) let relay.recentPlayed.find throw and
        // 500 the page. Missing fields now fall back to renderable defaults too.
        it('a home payload missing fields ({}) must not crash the load', async () => {
            stubRelay({ home: {} })
            const data = await load()
            expect(data.session).toBeNull()
            expect(data.middle.kind).toBe('stats')
        })

        it('home payload of literal null falls back to EMPTY_RELAY defaults', async () => {
            stubRelay({ home: null, lib: null, wl: null, discover: null })
            const data = await load()
            expect(data.session).toBeNull()
            expect(data.middle).toEqual({ kind: 'stats', hours: 0, achievements: 0, ratings: 0, added: 0, wishlisted: 0 })
            expect(data.libPosters).toEqual([])
            expect(data.discPosters).toEqual([])
        })

        it('discover sections with null items are tolerated', async () => {
            stubRelay({
                home: homePayload(),
                discover: [
                    { id: 'a', page: 1, pages: 1, items: null },
                    discoverSection([discItem(1)]),
                ],
            })
            const data = await load()
            expect(data.discPosters.map(p => p.appid)).toEqual([1])
        })

        it('discover items without a headerImage produce an empty poster string, not undefined', async () => {
            stubRelay({ home: homePayload(), discover: [discoverSection([{ appid: 5, name: 'NoArt' }])] })
            const data = await load()
            expect(data.discPosters).toEqual([{ appid: 5, poster: '' }])
        })
    })

    // ── Content filtering: session card ─────────────────────────────────────

    describe('session card content filtering', () => {
        it('skips a child-locked most-recent game and falls to the next visible one', async () => {
            await setFlag(100, 'childLock', true)
            stubRelay({ home: homePayload({ recentPlayed: [played(100), played(200)] }) })
            const data = await load()
            expect(data.session?.appid).toBe(200)
        })

        it('session is null when every recently-played game is hidden', async () => {
            await setFlag(100, 'childLock', true)
            await setFlag(200, 'filtered', true)
            await setFlag(300, 'software', true)
            stubRelay({ home: homePayload({ recentPlayed: [played(100), played(200), played(300)] }) })
            const data = await load()
            expect(data.session).toBeNull()
        })

        it('a child-locked game may appear only after the user opts in via showChildLocked', async () => {
            await setFlag(100, 'childLock', true)
            await patchSettings({ showChildLocked: true })
            stubRelay({ home: homePayload({ recentPlayed: [played(100)] }) })
            const data = await load()
            expect(data.session?.appid).toBe(100)
        })

        it('filtered and software flags each hide the session card under default settings', async () => {
            await setFlag(11, 'filtered', true)
            stubRelay({ home: homePayload({ recentPlayed: [played(11)] }) })
            expect((await load()).session).toBeNull()

            await setFlag(12, 'software', true)
            stubRelay({ home: homePayload({ recentPlayed: [played(12)] }) })
            expect((await load()).session).toBeNull()
        })
    })

    // ── Content filtering: posters ──────────────────────────────────────────

    describe('poster mosaics content filtering', () => {
        it('hidden-flagged appids are excluded from library and wishlist posters', async () => {
            await setFlag(2, 'childLock', true)
            await setFlag(3, 'filtered', true)
            await setFlag(4, 'software', true)
            const posters = [1, 2, 3, 4].map(appid => ({ appid, poster: `p${appid}` }))
            stubRelay({ home: homePayload(), lib: posters, wl: posters })
            const data = await load()
            expect(data.libPosters.map(p => p.appid)).toEqual([1])
            expect(data.wlPosters.map(p => p.appid)).toEqual([1])
        })

        it('enabling all show* toggles restores the flagged posters', async () => {
            await setFlag(2, 'childLock', true)
            await setFlag(3, 'filtered', true)
            await setFlag(4, 'software', true)
            await patchSettings({ showChildLocked: true, showFiltered: true, showSoftware: true })
            const posters = [1, 2, 3, 4].map(appid => ({ appid, poster: `p${appid}` }))
            stubRelay({ home: homePayload(), lib: posters })
            const data = await load()
            expect(data.libPosters.map(p => p.appid).sort()).toEqual([1, 2, 3, 4])
        })

        it('a child-locked appid never reaches the discover mosaic', async () => {
            await setFlag(66, 'childLock', true)
            stubRelay({ home: homePayload(), discover: [discoverSection([discItem(66), discItem(67)])] })
            const data = await load()
            expect(data.discPosters.map(p => p.appid)).toEqual([67])
        })
    })

    // ── Adult content ───────────────────────────────────────────────────────

    describe('adult content in discover', () => {
        it('isAdult items are excluded by default (hideAdultContent defaults true, even with no settings file)', async () => {
            stubRelay({ home: homePayload(), discover: [discoverSection([discItem(1, { isAdult: true }), discItem(2)])] })
            const data = await load()
            expect(data.discPosters.map(p => p.appid)).toEqual([2])
        })

        it('isAdult items are included only after explicitly disabling hideAdultContent', async () => {
            await patchSettings({ hideAdultContent: false })
            stubRelay({ home: homePayload(), discover: [discoverSection([discItem(1, { isAdult: true }), discItem(2)])] })
            const data = await load()
            expect(new Set(data.discPosters.map(p => p.appid))).toEqual(new Set([1, 2]))
        })
    })

    // ── titleBlocklist ──────────────────────────────────────────────────────

    describe('titleBlocklist', () => {
        it('matches case-insensitively and as a substring', async () => {
            await patchSettings({ titleBlocklist: ['HALO'] })
            stubRelay({
                home: homePayload(),
                discover: [discoverSection([
                    discItem(1, { name: 'Halo: Reach' }),
                    discItem(2, { name: 'halo infinite' }),
                    discItem(3, { name: 'Portal 2' }),
                ])],
            })
            const data = await load()
            expect(data.discPosters.map(p => p.appid)).toEqual([3])
        })

        // REGRESSION: blocklist matching once lowercased but
        // never Unicode-normalizes. A blocklist entry saved in NFC ("pokémon")
        // does not match a title in NFD ("pokémon"), so a visually identical
        // blocked title leaked into the discover mosaic. Both sides are now
        // normalized before comparison.
        it('a blocked title must not bypass the blocklist via a different Unicode normalization', async () => {
            await patchSettings({ titleBlocklist: ['pokémon'] })           // NFC é
            stubRelay({
                home: homePayload(),
                discover: [discoverSection([discItem(9, { name: 'Pokémon Scarlet' })])], // NFD e + ́
            })
            const data = await load()
            expect(data.discPosters.map(p => p.appid)).not.toContain(9)
        })

        // Documented fail-safe: an empty-string blocklist entry blocks EVERYTHING
        // (`''.includes` is always true). Over-blocking, not a leak — but a single
        // stray empty entry silently empties the whole discover mosaic.
        it('an empty-string blocklist entry blocks every discover item (fail-safe over-block, documented)', async () => {
            await patchSettings({ titleBlocklist: [''] })
            stubRelay({ home: homePayload(), discover: [discoverSection([discItem(1), discItem(2)])] })
            const data = await load()
            expect(data.discPosters).toEqual([])
        })

        // REGRESSION: with a non-empty blocklist, item.name.toLowerCase() once threw on
        // a discover item with a missing/null name (partial relay data), 500ing the
        // whole page. A null name is now handled instead of crashing.
        it('a discover item with a null name must not crash the load when a blocklist is set', async () => {
            await patchSettings({ titleBlocklist: ['anything'] })
            stubRelay({
                home: homePayload(),
                discover: [discoverSection([{ appid: 1, name: null as unknown as string }, discItem(2)])],
            })
            const data = await load()
            expect(data.discPosters.map(p => p.appid)).toContain(2)
        })
    })

    // ── sampleDiscover randomness ───────────────────────────────────────────

    describe('sampleDiscover sampling', () => {
        it('returns every allowed item exactly once when fewer than the cap (set equality, order-agnostic)', async () => {
            const items = [1, 2, 3, 4, 5, 6].map(i => discItem(i))
            stubRelay({ home: homePayload(), discover: [discoverSection(items.slice(0, 3)), discoverSection(items.slice(3))] })
            const data = await load()
            const ids = data.discPosters.map(p => p.appid)
            expect(ids.length).toBe(6)
            expect(new Set(ids)).toEqual(new Set([1, 2, 3, 4, 5, 6]))
        })

        it('caps at 50 posters drawn only from the allowed pool', async () => {
            await setFlag(999, 'childLock', true)
            const items = Array.from({ length: 60 }, (_, i) => discItem(i + 1))
            items.push(discItem(999))
            stubRelay({ home: homePayload(), discover: [discoverSection(items)] })
            const data = await load()
            expect(data.discPosters.length).toBe(50)
            const ids = data.discPosters.map(p => p.appid)
            expect(new Set(ids).size).toBe(50)              // no duplicates from the shuffle
            expect(ids).not.toContain(999)                  // hidden item never sampled
            for (const id of ids) expect(id).toBeGreaterThanOrEqual(1)
        })
    })

    // ── Middle-card priority ────────────────────────────────────────────────

    describe('middle card priority', () => {
        it('release wins when present and visible', async () => {
            stubRelay({
                home: homePayload({
                    release: { appid: 7, name: 'New Game', header: 'h7' },
                    justBought: [bought(8)],
                    recentPlayed: [played(9, { guide: GUIDE })],
                }),
            })
            const data = await load()
            expect(data.middle).toEqual({ kind: 'release', appid: 7, name: 'New Game', header: 'h7' })
        })

        it('a child-locked release never reaches the middle card — falls through to bought', async () => {
            await setFlag(7, 'childLock', true)
            stubRelay({
                home: homePayload({ release: { appid: 7, name: 'Hidden', header: 'h7' }, justBought: [bought(8)] }),
            })
            const data = await load()
            expect(data.middle.kind).toBe('bought')
            expect((data.middle as { appid: number }).appid).toBe(8)
        })

        it('bought pick only ever lands on a visible purchase (flagged entries are never sampled)', async () => {
            await setFlag(20, 'childLock', true)
            stubRelay({ home: homePayload({ justBought: [bought(10), bought(20), bought(30)] }) })
            // pick() is random — hammer it and assert the hidden appid never surfaces.
            for (let i = 0; i < 15; i++) {
                const data = await load()
                expect(data.middle.kind).toBe('bought')
                expect([10, 30]).toContain((data.middle as { appid: number }).appid)
            }
        })

        it('all purchases hidden + visible session with a guide → guide card for the visible session', async () => {
            await setFlag(8, 'filtered', true)
            stubRelay({
                home: homePayload({ justBought: [bought(8)], recentPlayed: [played(9, { guide: GUIDE })] }),
            })
            const data = await load()
            expect(data.middle.kind).toBe('guide')
            expect((data.middle as { appid: number }).appid).toBe(9)
            expect((data.middle as { guide: unknown }).guide).toEqual(GUIDE)
        })

        it('a hidden game with a guide must not leak through the guide card — resolves to stats instead', async () => {
            // recentPlayed[0] is child-locked and has a guide; recentPlayed[1] is
            // visible but guideless. The guide card must track the VISIBLE session.
            await setFlag(50, 'childLock', true)
            stubRelay({
                home: homePayload({ recentPlayed: [played(50, { guide: GUIDE }), played(51)] }),
            })
            const data = await load()
            expect(data.session?.appid).toBe(51)
            expect(data.middle.kind).toBe('stats')
        })

        it('everything hidden or absent falls through to stats with the relay values', async () => {
            await setFlag(7, 'childLock', true)
            await setFlag(8, 'childLock', true)
            stubRelay({
                home: homePayload({ release: { appid: 7, name: 'X', header: 'h' }, justBought: [bought(8)], recentPlayed: [] }),
            })
            const data = await load()
            expect(data.middle).toEqual({ kind: 'stats', hours: 12, achievements: 34, ratings: 7, added: 5, wishlisted: 6 })
        })
    })

    // ── Service failure ─────────────────────────────────────────────────────

    describe('flags/settings service failure', () => {
        it('DATA_DIR unset: services reject, load still resolves with safe defaults (adult content stays hidden)', async () => {
            delete process.env.DATA_DIR
            stubRelay({
                home: homePayload({ recentPlayed: [played(1)] }),
                discover: [discoverSection([discItem(2, { isAdult: true }), discItem(3)])],
            })
            const data = await load()
            expect(data.session?.appid).toBe(1)
            // fallback settings keep hideAdultContent=true — no adult leak on service failure
            expect(data.discPosters.map(p => p.appid)).toEqual([3])
        })
    })
})
