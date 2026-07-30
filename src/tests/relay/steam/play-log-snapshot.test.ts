// @ts-nocheck — the service is untyped .js; assertions are runtime-verified.
//
// Boot snapshot for the play-log store. load() used to read every per-game session
// file individually: measured on the NAS, 744 files holding only 100 KB cost 2574 ms
// uncontended, and ~51s during boot while the index refreshes competed for it — with
// the landing page rendering an empty session card and "0 hours played" until it
// finished. These tests pin the single-read fast path and, just as importantly, the
// fallbacks: the per-game files stay the source of truth, so an absent, corrupt,
// version-skewed or truncated snapshot must never serve wrong data or lose a write.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

const SNAPSHOT = 'sessions-index.json'

let tmpDir: string
let mod: typeof import('../../../lib/server/relay/steam/play-log.service.js')

function sessionsDir() { return path.join(tmpDir, 'relay', 'steam', 'sessions') }
function snapshotPath() { return path.join(tmpDir, 'relay', 'steam', SNAPSHOT) }

async function writeGameFile(appid: number, data: Record<string, unknown>) {
    await fs.mkdir(sessionsDir(), { recursive: true })
    await fs.writeFile(path.join(sessionsDir(), `${appid}.json`), JSON.stringify(data))
}

function game(name: string, minutes = 60, lastPlayedAt = '2026-07-28T10:00:00.000Z') {
    return {
        name,
        baseline: 0,
        openSession: null,
        sessions: [{ startedAt: lastPlayedAt, endedAt: '2026-07-28T11:00:00.000Z', durationMin: minutes, achievements: [] }],
    }
}

async function readSnapshot() {
    return JSON.parse(await fs.readFile(snapshotPath(), 'utf8'))
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-play-log-snap-'))
    process.env.DATA_DIR = tmpDir
    delete process.env.RELAY_DATA_ROOT
    await fs.mkdir(path.join(tmpDir, 'relay', 'steam'), { recursive: true })
    // Fresh module per test: the store and the loaded flag are module-level.
    vi.resetModules()
    mod = await import('../../../lib/server/relay/steam/play-log.service.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

describe('play-log boot snapshot', () => {
    it('first boot scans the per-game files and writes the snapshot', async () => {
        await writeGameFile(570, game('Dota 2'))
        await writeGameFile(730, game('CS'))

        await mod.load()

        expect(Object.keys(mod.getLastPlayedMap())).toHaveLength(2)
        const snap = await readSnapshot()
        expect(snap.v).toBe(1)
        expect(snap.games.map((g: { appid: number }) => g.appid).sort((a, b) => a - b)).toEqual([570, 730])
    })

    // The point of the whole change: one read, no per-file traffic. Proven by deleting
    // the session files first — a scan would come back empty.
    it('a later boot loads from the snapshot without reading the per-game files', async () => {
        await writeGameFile(570, game('Dota 2', 90))
        await mod.load()
        await fs.rm(sessionsDir(), { recursive: true, force: true })

        vi.resetModules()
        const fresh = await import('../../../lib/server/relay/steam/play-log.service.js')
        await fresh.load()

        expect(fresh.getEffectivePlaytimeMin(570)).toBe(90)
        expect(fresh.getLastPlayedMap()['570']).toBeTruthy()
    })

    it('restores names, baselines and open sessions through the snapshot', async () => {
        await writeGameFile(570, { name: 'Dota 2', baseline: 1200, openSession: { startedAt: '2026-07-29T09:00:00.000Z' }, sessions: [] })
        await mod.load()

        vi.resetModules()
        const fresh = await import('../../../lib/server/relay/steam/play-log.service.js')
        await fresh.load()

        const open = await fresh.getOpenSession()
        expect(open).toMatchObject({ appid: 570, name: 'Dota 2', startedAt: '2026-07-29T09:00:00.000Z' })
        expect(fresh.getEffectivePlaytimeMin(570)).toBeGreaterThanOrEqual(1200)
    })

    for (const [label, body] of [
        ['corrupt',           '{ not json at all'],
        ['a newer version',   JSON.stringify({ v: 99, games: [{ appid: 1, name: 'X' }] })],
        ['an empty game list', JSON.stringify({ v: 1, games: [] })],
    ] as const) {
        it(`falls back to the per-file scan when the snapshot is ${label}`, async () => {
            await writeGameFile(570, game('Dota 2', 45))
            await fs.writeFile(snapshotPath(), body)

            await mod.load()

            // Scanned, not trusted — and the bad snapshot is replaced with a good one.
            expect(mod.getEffectivePlaytimeMin(570)).toBe(45)
            const snap = await readSnapshot()
            expect(snap.v).toBe(1)
            expect(snap.games).toHaveLength(1)
        })
    }

    it('a session write updates the snapshot, so the next boot sees it', async () => {
        await mod.load()
        await mod.openSession(570, 'Dota 2', '2026-07-29T09:00:00.000Z')
        await mod.closeSession(570, '2026-07-29T10:00:00.000Z')
        await mod.close()   // flush the debounced snapshot write

        vi.resetModules()
        const fresh = await import('../../../lib/server/relay/steam/play-log.service.js')
        await fresh.load()
        expect(fresh.getEffectivePlaytimeMin(570)).toBeGreaterThan(0)
        expect(fresh.getSessions()[570]?.sessions ?? []).toHaveLength(1)
    })

    it('close() is safe when there is nothing pending', async () => {
        await mod.load()
        await expect(mod.close()).resolves.toBeUndefined()
    })

    // The per-game files remain authoritative, so a snapshot that missed a write
    // (crash between flush and the debounce) is repaired in the background.
    it('reconciles against the session files after a snapshot boot', async () => {
        await writeGameFile(570, game('Dota 2'))
        await mod.load()                      // writes the snapshot for [570]

        await writeGameFile(730, game('CS'))  // appeared out of band

        vi.resetModules()
        const fresh = await import('../../../lib/server/relay/steam/play-log.service.js')
        await fresh.load()                    // snapshot path: sees only 570 at first

        await vi.waitFor(() => {
            expect(Object.keys(fresh.getLastPlayedMap())).toHaveLength(2)
        })
        // ...and the repaired store is written back.
        await vi.waitFor(async () => {
            const snap = await readSnapshot()
            expect(snap.games).toHaveLength(2)
        })
    })

    // "Never dump empty over good data" — the same guard the shared persisted indexes
    // use. A vanished/unreadable sessions dir is a transient fault, not a real wipe.
    it('keeps the snapshot data when the reconcile scan comes back empty', async () => {
        await writeGameFile(570, game('Dota 2', 75))
        await mod.load()

        // Snapshot survives; the authoritative files momentarily do not.
        await fs.rm(sessionsDir(), { recursive: true, force: true })

        vi.resetModules()
        const fresh = await import('../../../lib/server/relay/steam/play-log.service.js')
        await fresh.load()

        // Give the background reconcile room to run and (correctly) decline.
        await new Promise(r => setTimeout(r, 150))
        expect(fresh.getEffectivePlaytimeMin(570)).toBe(75)
        expect(Object.keys(fresh.getLastPlayedMap())).toHaveLength(1)
    })

    it('load() is idempotent — a second call does not re-read or clobber', async () => {
        await writeGameFile(570, game('Dota 2', 30))
        await mod.load()
        await mod.load()
        expect(mod.getEffectivePlaytimeMin(570)).toBe(30)
    })
})
