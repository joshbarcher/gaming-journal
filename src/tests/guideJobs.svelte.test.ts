// Adversarial tests for src/lib/guide-jobs.svelte.ts
//
// Singleton store fed by a per-page EventSource (DownloadsPage) plus manual
// fetchAll/enqueue. Focus: malformed events, fetch failures, out-of-order
// responses clobbering fresher SSE state, duplicate enqueues, jobFor lookup
// semantics that the DownloadsPage re-queue guard depends on.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { jobStore, type Job } from '$lib/guide-jobs.svelte.js'

function makeJob(overrides: Partial<Job> = {}): Job {
    return {
        id:          'job-1',
        steamId:     '620',
        source:      'ign',
        guideId:     'walkthrough',
        url:         'https://example.test/guide',
        gameName:    'Portal 2',
        status:      'pending',
        progress:    { download: 0, pages: 0, subtask: 0 },
        log:         [],
        createdAt:   '2026-07-15T00:00:00Z',
        startedAt:   null,
        completedAt: null,
        error:       null,
        sizeBytes:   null,
        ...overrides,
    }
}

function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!:  (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: () => Promise.resolve(body) } as unknown as Response
}

beforeEach(() => {
    jobStore.jobs = []   // singleton — hard reset between tests
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('applyEvent', () => {
    it('snapshot replaces the whole list', () => {
        jobStore.jobs = [makeJob({ id: 'old' })]
        jobStore.applyEvent({ type: 'snapshot', jobs: [makeJob({ id: 'a' }), makeJob({ id: 'b' })] })
        expect(jobStore.jobs.map(j => j.id)).toEqual(['a', 'b'])
    })

    it('snapshot with missing jobs field clears the list instead of crashing', () => {
        jobStore.jobs = [makeJob()]
        jobStore.applyEvent({ type: 'snapshot' })
        expect(jobStore.jobs).toEqual([])
    })

    it('unknown job id is appended; known id is replaced wholesale in place', () => {
        jobStore.applyEvent(makeJob({ id: 'a', status: 'pending' }))
        jobStore.applyEvent(makeJob({ id: 'b', status: 'pending' }))
        jobStore.applyEvent(makeJob({ id: 'a', status: 'running', log: ['started'] }))
        expect(jobStore.jobs.map(j => j.id)).toEqual(['a', 'b'])          // order preserved
        expect(jobStore.jobs[0].status).toBe('running')
        expect(jobStore.jobs[0].log).toEqual(['started'])
    })

    it('CONTRACT: an event with no id becomes a phantom row, and a second no-id event replaces it (both key on undefined)', () => {
        jobStore.jobs = [makeJob({ id: 'real' })]
        jobStore.applyEvent({ status: 'running' })          // malformed: no id
        expect(jobStore.jobs).toHaveLength(2)
        jobStore.applyEvent({ status: 'error' })            // second malformed event
        expect(jobStore.jobs).toHaveLength(2)               // replaced the phantom, not appended
        expect((jobStore.jobs[1] as unknown as { status: string }).status).toBe('error')
        expect(jobStore.jobs[0].id).toBe('real')            // real job untouched
    })

    it('applyEvent(null) is a safe no-op (guarded like tracker-suggest-jobs)', () => {
        expect(() => jobStore.applyEvent(null)).not.toThrow()
        expect(() => jobStore.applyEvent(undefined)).not.toThrow()
        expect(jobStore.jobs).toEqual([])
    })

    it('activeCount counts pending + running only, and stays consistent through a burst of events', () => {
        jobStore.applyEvent(makeJob({ id: 'a', status: 'pending' }))
        jobStore.applyEvent(makeJob({ id: 'b', status: 'running' }))
        jobStore.applyEvent(makeJob({ id: 'c', status: 'done' }))
        jobStore.applyEvent(makeJob({ id: 'd', status: 'error' }))
        jobStore.applyEvent(makeJob({ id: 'e', status: 'cancelled' }))
        expect(jobStore.activeCount).toBe(2)
        // burst: flip everything terminal
        jobStore.applyEvent(makeJob({ id: 'a', status: 'done' }))
        jobStore.applyEvent(makeJob({ id: 'b', status: 'error' }))
        expect(jobStore.activeCount).toBe(0)
        expect(jobStore.jobs).toHaveLength(5)
    })
})

describe('fetchAll', () => {
    it('network failure leaves jobs untouched and does not throw', async () => {
        jobStore.jobs = [makeJob()]
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
        await expect(jobStore.fetchAll()).resolves.toBeUndefined()
        expect(jobStore.jobs).toHaveLength(1)
    })

    it('HTTP error leaves jobs untouched', async () => {
        jobStore.jobs = [makeJob()]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, false, 502)))
        await jobStore.fetchAll()
        expect(jobStore.jobs).toHaveLength(1)
    })

    it('malformed JSON body is swallowed and jobs stay untouched', async () => {
        jobStore.jobs = [makeJob()]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok:   true,
            json: () => Promise.reject(new SyntaxError('bad json')),
        } as unknown as Response))
        await expect(jobStore.fetchAll()).resolves.toBeUndefined()
        expect(jobStore.jobs).toHaveLength(1)
    })

    // BUG: guide-jobs.svelte.ts:44 — fetchAll() assigns `this.jobs = await res.json()`
    // unconditionally, so a fetchAll whose response arrives AFTER a live SSE event has
    // updated a job overwrites the newer state with the stale server list (the job
    // visibly regresses from done back to running until the next event).
    it('a slow fetchAll response must not clobber a fresher SSE update (regression)', async () => {
        const slow = deferred<Response>()
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(slow.promise))

        const pending = jobStore.fetchAll()                                   // response in flight…
        jobStore.applyEvent(makeJob({ id: 'a', status: 'done', completedAt: '2026-07-15T01:00:00Z' }))
        expect(jobStore.jobs[0].status).toBe('done')

        slow.resolve(jsonResponse([makeJob({ id: 'a', status: 'running' })])) // …stale list lands late
        await pending

        // Correct behavior: the newer 'done' state wins.
        expect(jobStore.jobs[0].status).toBe('done')
    })
})

describe('enqueue', () => {
    it('appends the job returned by the server', async () => {
        const job = makeJob({ id: 'new-1' })
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(job)))
        const returned = await jobStore.enqueue({ steamId: '620', source: 'ign', guideId: 'walkthrough', url: 'u' })
        expect(returned.id).toBe('new-1')
        expect(jobStore.jobs).toHaveLength(1)
    })

    it('HTTP error throws with the status and leaves jobs unchanged', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, false, 429)))
        await expect(
            jobStore.enqueue({ steamId: '620', source: 'ign', guideId: 'g', url: 'u' })
        ).rejects.toThrow('Enqueue failed: HTTP 429')
        expect(jobStore.jobs).toEqual([])
    })

    it('a JSON parse failure after 200 OK propagates and leaves jobs unchanged', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok:   true,
            json: () => Promise.reject(new SyntaxError('truncated body')),
        } as unknown as Response))
        await expect(
            jobStore.enqueue({ steamId: '620', source: 'ign', guideId: 'g', url: 'u' })
        ).rejects.toThrow(SyntaxError)
        expect(jobStore.jobs).toEqual([])
    })

    it('duplicate enqueue (server returns an id already in the list) does not create a duplicate row', async () => {
        jobStore.jobs = [makeJob({ id: 'dup', status: 'pending' })]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(makeJob({ id: 'dup', status: 'pending' }))))
        await jobStore.enqueue({ steamId: '620', source: 'ign', guideId: 'walkthrough', url: 'u' })
        expect(jobStore.jobs).toHaveLength(1)
    })

    it('an SSE update that lands between POST and response is NOT clobbered by the enqueue response', async () => {
        // guide-jobs enqueue only inserts when the id is absent (guide-jobs.svelte.ts:56-57),
        // so a fresher 'running' event that beat the POST response survives. (Contrast with
        // trackerSuggestJobStore.enqueue, which clobbers — see trackerSuggestJobs tests.)
        const slow = deferred<Response>()
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(slow.promise))

        const p = jobStore.enqueue({ steamId: '620', source: 'ign', guideId: 'walkthrough', url: 'u' })
        jobStore.applyEvent(makeJob({ id: 'race-1', status: 'running', startedAt: '2026-07-15T01:00:00Z' }))
        slow.resolve(jsonResponse(makeJob({ id: 'race-1', status: 'pending' })))
        await p

        expect(jobStore.jobs).toHaveLength(1)
        expect(jobStore.jobs[0].status).toBe('running')
    })

    it('two overlapping enqueues for different guides both land exactly once', async () => {
        const d1 = deferred<Response>()
        const d2 = deferred<Response>()
        vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise))

        const p1 = jobStore.enqueue({ steamId: '620', source: 'ign',      guideId: 'walkthrough', url: 'u1' })
        const p2 = jobStore.enqueue({ steamId: '620', source: 'gamefaqs', guideId: 'faq',         url: 'u2' })
        // resolve in reverse order to shake out index-capture bugs
        d2.resolve(jsonResponse(makeJob({ id: 'b', source: 'gamefaqs', guideId: 'faq' })))
        await p2
        d1.resolve(jsonResponse(makeJob({ id: 'a' })))
        await p1

        expect(jobStore.jobs.map(j => j.id).sort()).toEqual(['a', 'b'])
    })
})

describe('cancel', () => {
    it('CONTRACT: a failed DELETE rejects — cancel has no catch, callers own the error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
        await expect(jobStore.cancel('job-1')).rejects.toThrow('offline')
    })

    it('cancel does not remove or mutate the local job (state changes only arrive via events)', async () => {
        jobStore.jobs = [makeJob({ id: 'c1', status: 'pending' })]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null)))
        await jobStore.cancel('c1')
        expect(jobStore.jobs[0].status).toBe('pending')
    })
})

describe('jobFor', () => {
    it('matches on steamId + source + guideId, stringifying the caller argument', () => {
        jobStore.jobs = [makeJob({ id: 'x', steamId: '620', source: 'ign', guideId: 'walkthrough' })]
        expect(jobStore.jobFor(620 as unknown as string, 'ign', 'walkthrough')?.id).toBe('x')
        expect(jobStore.jobFor('620', 'ign', 'other')).toBeUndefined()
        expect(jobStore.jobFor('999', 'ign', 'walkthrough')).toBeUndefined()
    })

    it('CONTRACT: coercion is one-sided — a job whose steamId arrived as a NUMBER is never found', () => {
        // jobFor compares j.steamId === String(steamId) (guide-jobs.svelte.ts:67): the
        // argument is stringified but the stored field is not, so a relay payload with a
        // numeric steamId silently breaks lookups. Documented actual behavior.
        jobStore.jobs = [makeJob({ id: 'n', steamId: 620 as unknown as string })]
        expect(jobStore.jobFor('620', 'ign', 'walkthrough')).toBeUndefined()
        expect(jobStore.jobFor(620 as unknown as string, 'ign', 'walkthrough')).toBeUndefined()
    })

    // BUG: guide-jobs.svelte.ts:65-71 — jobFor returns the FIRST match with no status
    // filter, so when a finished job and a re-queued active job for the same guide
    // coexist (the normal re-download flow), the stale finished job shadows the active
    // one. DownloadsPage's re-queue guard (`if (active?.status === 'pending' || …) return`)
    // then sees 'done' and lets the user enqueue the same guide again — duplicate jobs.
    // (Contrast: trackerSuggestJobStore.jobFor filters to pending/running.)
    it('jobFor must return the active job when a finished sibling for the same guide exists (regression)', () => {
        jobStore.jobs = [
            makeJob({ id: 'old', status: 'done', completedAt: '2026-07-14T00:00:00Z' }),
            makeJob({ id: 'new', status: 'pending' }),   // re-queued, same steamId/source/guideId
        ]
        const found = jobStore.jobFor('620', 'ign', 'walkthrough')
        expect(found?.id).toBe('new')
        expect(found?.status).toBe('pending')
    })
})
