// @ts-nocheck — job-queue.js is untyped JS; assertions are runtime-verified by vitest.
//
// Covers the queue's script pipeline, in particular the 'reparse' mode added for the
// re-parse button on the guides list: it must re-run parse-guide.js over the raw HTML
// already on disk and NEVER re-hit the source site via fetch-guide.js.
import { describe, it, beforeEach, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:child_process', () => {
    const spawn = vi.fn()
    return { spawn, default: { spawn } }
})

import { spawn } from 'node:child_process'
import { enqueueJob, getJobs } from '../../../lib/server/relay/guides/job-queue.js'

const spawnMock = vi.mocked(spawn)

/** A child process that exits 0 on the next tick. */
function fakeChild(exitCode = 0) {
    const child = new EventEmitter() as any
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdout.setEncoding = () => {}
    child.stderr.setEncoding = () => {}
    setTimeout(() => child.emit('close', exitCode), 0)
    return child
}

/** Script filenames spawned so far, in order (e.g. ['fetch-guide.js','parse-guide.js']). */
function spawnedScripts(): string[] {
    return spawnMock.mock.calls.map(call => {
        const args = call[1] as string[]
        return String(args[0]).split(/[\\/]/).pop()
    })
}

/** Waits for the queue's async worker to finish the job. */
async function settle(job: any) {
    for (let i = 0; i < 100; i++) {
        if (job.status === 'done' || job.status === 'error') return
        await new Promise(r => setTimeout(r, 5))
    }
    throw new Error(`job never settled (status: ${job.status})`)
}

let seq = 0
const uniq = () => `guide-${++seq}-${Math.random().toString(36).slice(2)}`

describe('guide job queue — reparse mode', () => {
    beforeEach(() => {
        spawnMock.mockReset()
        spawnMock.mockImplementation(() => fakeChild(0))
    })

    it('runs fetch then parse for a normal download', async () => {
        const job = enqueueJob({ steamId: '1', source: 'neoseeker', guideId: uniq(), url: 'https://x.test/g' })
        await settle(job)
        expect(spawnedScripts()).toEqual(['fetch-guide.js', 'parse-guide.js'])
        expect(job.status).toBe('done')
    })

    it('runs ONLY parse for a reparse — never re-fetches the source', async () => {
        const job = enqueueJob({ steamId: '1', source: 'neoseeker', guideId: uniq(), url: 'https://x.test/g', mode: 'reparse' })
        await settle(job)
        const scripts = spawnedScripts()
        expect(scripts).toEqual(['parse-guide.js'])
        expect(scripts).not.toContain('fetch-guide.js')
    })

    it('passes the guide identity through to parse-guide.js', async () => {
        const guideId = uniq()
        const job = enqueueJob({ steamId: '42', source: 'game8', guideId, url: '', mode: 'reparse' })
        await settle(job)
        const args = spawnMock.mock.calls[0][1] as string[]
        expect(args).toContain('--steam-id'); expect(args).toContain('42')
        expect(args).toContain('--source');   expect(args).toContain('game8')
        expect(args).toContain('--guide-id'); expect(args).toContain(guideId)
    })

    it('reports the fetch bar complete up front so the shared UI is not stuck at 0%', () => {
        const job = enqueueJob({ steamId: '1', source: 'ign', guideId: uniq(), url: '', mode: 'reparse' })
        expect(job.progress.download).toBe(100)
        expect(job.mode).toBe('reparse')
    })

    it('a normal download still starts its fetch bar at 0%', () => {
        const job = enqueueJob({ steamId: '1', source: 'ign', guideId: uniq(), url: 'https://x.test/g' })
        expect(job.progress.download).toBe(0)
        expect(job.mode).toBe('download')
    })

    it('defaults to download mode when none is given', () => {
        const job = enqueueJob({ steamId: '1', source: 'ign', guideId: uniq(), url: 'https://x.test/g' })
        expect(job.mode).toBe('download')
    })

    it('surfaces a failing parse as an error job', async () => {
        spawnMock.mockImplementation(() => fakeChild(1))
        const job = enqueueJob({ steamId: '1', source: 'ign', guideId: uniq(), url: '', mode: 'reparse' })
        await settle(job)
        expect(job.status).toBe('error')
        expect(job.error).toMatch(/parse-guide/)
    })

    it('does not enqueue a duplicate while one is already active for the same guide', () => {
        const guideId = uniq()
        const a = enqueueJob({ steamId: '7', source: 'fandom', guideId, url: '', mode: 'reparse' })
        const b = enqueueJob({ steamId: '7', source: 'fandom', guideId, url: '', mode: 'reparse' })
        expect(b.id).toBe(a.id)
        expect(getJobs().filter(j => j.guideId === guideId)).toHaveLength(1)
    })
})
