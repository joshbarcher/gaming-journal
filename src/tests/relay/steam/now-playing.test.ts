// @ts-nocheck — drives the ported now-playing poller over untyped .js services;
// play-log assertions go through the real service against a temp DATA_DIR.
//
// These tests exist for the Wave-4 gate (docs/relay-fold-in.md Phase 5): the
// relay closed an open session on a SINGLE empty presence response — the
// "post-restart poll flap". The ported service debounces absence
// (NOW_PLAYING_CLOSE_MISSES consecutive empty polls, endedAt backdated to the
// first miss). Every scenario here scripts exact GetPlayerSummaries responses.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let dataDir: string
let summaries: Array<number | null> // scripted gameid per GetPlayerSummaries call
let realFetch: typeof fetch

function stubFetch() {
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: any) => {
        const url = String(input)
        if (url.includes('GetPlayerSummaries')) {
            const gameid = summaries.length ? summaries.shift() : null
            const player = gameid ? { gameid: String(gameid), gameextrainfo: `Game ${gameid}` } : {}
            return new Response(JSON.stringify({ response: { players: [player] } }), { status: 200 })
        }
        if (url.includes('GetPlayerAchievements')) {
            return new Response(JSON.stringify({ playerstats: { success: true, achievements: [] } }), { status: 200 })
        }
        if (url.includes('GetSchemaForGame')) {
            return new Response(JSON.stringify({ game: {} }), { status: 200 })
        }
        return new Response('{}', { status: 200 })
    }) as any
}

// Held so afterEach can flush play-log's debounced boot-snapshot write. Without
// that, the write lands ~3s later, recreates the temp tree via mkdir, and the
// cleanup rm fails with ENOTEMPTY.
let loadedPlayLog: typeof import('../../../lib/server/relay/steam/play-log.service.js') | null = null

async function loadModules() {
    vi.resetModules()
    const np = await import('../../../lib/server/relay/steam/now-playing.service.js')
    const playLog = await import('../../../lib/server/relay/steam/play-log.service.js')
    await playLog.load()
    loadedPlayLog = playLog
    return { np, playLog }
}

beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'gj-nowplaying-'))
    process.env.DATA_DIR = dataDir
    delete process.env.RELAY_DATA_ROOT
    process.env.STEAM_API_KEY = 'test-key'
    process.env.STEAM_ID = '7656119'
    delete process.env.NOW_PLAYING_CLOSE_MISSES
    summaries = []
    stubFetch()
})

afterEach(async () => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
    await loadedPlayLog?.close().catch(() => {})   // flush + stop writing before the tree goes away
    loadedPlayLog = null
    // maxRetries: on Windows an rm of a tree that was just written intermittently
    // fails ENOTEMPTY while handles are still being released (the store files here are
    // written right up to the end of each test).
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

// Let the fire-and-forget promises inside poll() settle.
const settle = () => new Promise(r => setTimeout(r, 25))

describe('now-playing absence debouncing (the restart-flap fix)', () => {
    it('opens a session on first positive detection', async () => {
        const { np, playLog } = await loadModules()
        summaries = [220]
        await np._pollOnce(); await settle()
        expect(np.get().playing).toMatchObject({ appid: 220, name: 'Game 220' })
        expect(await playLog.getOpenSession()).toMatchObject({ appid: 220 })
    })

    it('a single empty poll does NOT close the session (the flap)', async () => {
        const { np, playLog } = await loadModules()
        summaries = [220, null, 220]
        await np._pollOnce(); await settle()   // open
        await np._pollOnce(); await settle()   // one miss — hold
        expect(np.get().playing).toMatchObject({ appid: 220 })
        expect(await playLog.getOpenSession()).toMatchObject({ appid: 220 })
        await np._pollOnce(); await settle()   // recovered
        expect(np.get().playing).toMatchObject({ appid: 220 })
        // Still the SAME open session — no closed session was recorded (never split).
        expect(await playLog.getOpenSession()).not.toBeNull()
        const closed = (playLog.getSessions()['220']?.sessions ?? []).filter((s: any) => s.endedAt)
        expect(closed).toHaveLength(0)
    })

    it('closes only after the miss threshold, with endedAt backdated to the first miss', async () => {
        const { np, playLog } = await loadModules()
        summaries = [220, null, null, null]
        await np._pollOnce(); await settle()               // open
        const beforeFirstMiss = new Date().toISOString()
        await np._pollOnce(); await settle()               // miss 1 (records firstMissAt)
        const afterFirstMiss = new Date().toISOString()
        expect(np.get().playing).not.toBeNull()
        await np._pollOnce(); await settle()               // miss 2 — still open
        expect(np.get().playing).not.toBeNull()
        await np._pollOnce(); await settle()               // miss 3 — closes
        expect(np.get().playing).toBeNull()
        expect(await playLog.getOpenSession()).toBeNull()
        // endedAt is the first-miss time, not the third
        const closed = (playLog.getSessions()['220']?.sessions ?? []).filter((s: any) => s.endedAt)
        expect(closed.length).toBeGreaterThanOrEqual(1)
        const ended = closed[closed.length - 1].endedAt
        expect(ended >= beforeFirstMiss && ended <= afterFirstMiss).toBe(true)
    })

    it('a positive game switch closes immediately and opens the new session', async () => {
        const { np, playLog } = await loadModules()
        summaries = [220, 400]
        await np._pollOnce(); await settle()
        await np._pollOnce(); await settle()
        expect(np.get().playing).toMatchObject({ appid: 400 })
        expect(await playLog.getOpenSession()).toMatchObject({ appid: 400 })
    })

    it('poll ERRORS never touch session state (relay behavior preserved)', async () => {
        const { np } = await loadModules()
        summaries = [220]
        await np._pollOnce(); await settle()
        globalThis.fetch = vi.fn(async () => { throw new Error('ECONNRESET') }) as any
        await np._pollOnce(); await settle()
        expect(np.get().playing).toMatchObject({ appid: 220 })
    })

    it('REGRESSION: restart recovery + immediate empty poll holds the session (the exact prod flap)', async () => {
        // Seed an open session as a previous process would have left it.
        {
            const playLog = await import('../../../lib/server/relay/steam/play-log.service.js')
            await playLog.load()
            await playLog.openSession(220, 'Game 220', new Date(Date.now() - 3_600_000).toISOString())
            await playLog.close?.()  // flush if the service exposes close; otherwise ManagedFile flush timing covers it
        }
        // "Restart": fresh module graph recovers the session; first poll is empty.
        const { np, playLog } = await loadModules()
        summaries = [null]
        await np.startPoller(); await settle()
        np.stopPoller()
        expect(np.get().playing).toMatchObject({ appid: 220 })       // still playing
        expect(await playLog.getOpenSession()).toMatchObject({ appid: 220 })
    })

    it('NOW_PLAYING_CLOSE_MISSES=1 restores the relay single-miss behavior', async () => {
        process.env.NOW_PLAYING_CLOSE_MISSES = '1'
        const { np, playLog } = await loadModules()
        summaries = [220, null]
        await np._pollOnce(); await settle()
        await np._pollOnce(); await settle()
        expect(np.get().playing).toBeNull()
        expect(await playLog.getOpenSession()).toBeNull()
    })
})
