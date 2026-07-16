// Adversarial tests for src/lib/tracker-suggest-jobs.svelte.ts
//
// Singleton store with a leader-elected EventSource fanned out over a
// BroadcastChannel. Focus: malformed SSE payloads, log-cap behavior, fetch
// failures, POST-response vs live-event races, snapshot clobbering, leader
// election paths (with and without Web Locks / BroadcastChannel).
//
// connect() latches a private #started flag with no reset, so connect tests
// get a FRESH module instance via vi.resetModules() + dynamic import; the
// stateless method tests use the statically imported singleton with jobs
// reset between tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { trackerSuggestJobStore, type TrackerSuggestJob } from '$lib/tracker-suggest-jobs.svelte.js'

// ── fakes ─────────────────────────────────────────────────────────────────────

class FakeEventSource {
    static instances: FakeEventSource[] = []
    url: string
    closed = false
    onmessage: ((e: { data: string }) => void) | null = null
    constructor(url: string) {
        this.url = url
        FakeEventSource.instances.push(this)
    }
    close() { this.closed = true }
    emitRaw(data: string) { this.onmessage?.({ data }) }
    emit(data: unknown) { this.emitRaw(JSON.stringify(data)) }
}

const bcRegistry = new Map<string, Set<FakeBroadcastChannel>>()
class FakeBroadcastChannel {
    static all: FakeBroadcastChannel[] = []
    name: string
    posted: unknown[] = []
    onmessage: ((e: { data: unknown }) => void) | null = null
    constructor(name: string) {
        this.name = name
        if (!bcRegistry.has(name)) bcRegistry.set(name, new Set())
        bcRegistry.get(name)!.add(this)
        FakeBroadcastChannel.all.push(this)
    }
    postMessage(data: unknown) {
        this.posted.push(data)
        // Per spec, a channel does NOT receive its own messages.
        for (const peer of bcRegistry.get(this.name)!) {
            if (peer !== this) peer.onmessage?.({ data })
        }
    }
    close() { bcRegistry.get(this.name)?.delete(this) }
}

async function freshStore() {
    vi.resetModules()
    const mod = await import('$lib/tracker-suggest-jobs.svelte.js')
    return mod.trackerSuggestJobStore
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTJob(overrides: Partial<TrackerSuggestJob> = {}): TrackerSuggestJob {
    return {
        id:          'ts-1',
        steamId:     '620',
        gameName:    'Portal 2',
        status:      'pending',
        progress:    0,
        log:         [],
        trackers:    null,
        createdAt:   '2026-07-15T00:00:00Z',
        startedAt:   null,
        completedAt: null,
        error:       null,
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
    trackerSuggestJobStore.jobs = []
    FakeEventSource.instances = []
    FakeBroadcastChannel.all = []
    bcRegistry.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'locks')
})

// ── seed ──────────────────────────────────────────────────────────────────────

describe('seed', () => {
    it('replaces jobs from an array and ignores null/undefined/non-array garbage', () => {
        trackerSuggestJobStore.seed([makeTJob({ id: 'a' })])
        expect(trackerSuggestJobStore.jobs).toHaveLength(1)
        trackerSuggestJobStore.seed(null)
        trackerSuggestJobStore.seed(undefined)
        trackerSuggestJobStore.seed({ jobs: [] } as unknown as TrackerSuggestJob[])
        expect(trackerSuggestJobStore.jobs).toHaveLength(1)      // untouched by garbage
        trackerSuggestJobStore.seed([])
        expect(trackerSuggestJobStore.jobs).toEqual([])          // empty array IS applied
    })

    it('CONTRACT: seed unconditionally overwrites fresher live state (SSR hydration wins)', () => {
        // If the SSE snapshot lands before onMount's seed(data.jobs), the older SSR
        // payload clobbers it. Self-heals on the next event, but this is the actual
        // behavior — seed does no freshness check (tracker-suggest-jobs.svelte.ts:31-33).
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'a', status: 'done' }))
        trackerSuggestJobStore.seed([makeTJob({ id: 'a', status: 'running' })])
        expect(trackerSuggestJobStore.jobs[0].status).toBe('running')
    })
})

// ── applyEvent ────────────────────────────────────────────────────────────────

describe('applyEvent', () => {
    it('null / undefined / false payloads are no-ops (guarded, unlike guide-jobs)', () => {
        trackerSuggestJobStore.jobs = [makeTJob()]
        expect(() => {
            trackerSuggestJobStore.applyEvent(null)
            trackerSuggestJobStore.applyEvent(undefined)
            trackerSuggestJobStore.applyEvent(false)
        }).not.toThrow()
        expect(trackerSuggestJobStore.jobs).toHaveLength(1)
    })

    it('snapshot replaces the list; snapshot with missing jobs clears it', () => {
        trackerSuggestJobStore.jobs = [makeTJob({ id: 'old' })]
        trackerSuggestJobStore.applyEvent({ type: 'snapshot', jobs: [makeTJob({ id: 'a' })] })
        expect(trackerSuggestJobStore.jobs.map(j => j.id)).toEqual(['a'])
        trackerSuggestJobStore.applyEvent({ type: 'snapshot' })
        expect(trackerSuggestJobStore.jobs).toEqual([])
    })

    it('full job events insert unknown ids and replace known ids preserving order', () => {
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'a', status: 'pending' }))
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'b', status: 'pending' }))
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'a', status: 'running', progress: 40 }))
        expect(trackerSuggestJobStore.jobs.map(j => j.id)).toEqual(['a', 'b'])
        expect(trackerSuggestJobStore.jobs[0].progress).toBe(40)
    })

    it('log delta for an unknown job id is dropped silently (no phantom rows — contrast guide-jobs)', () => {
        trackerSuggestJobStore.applyEvent({ type: 'log', id: 'ghost', line: 'boo' })
        expect(trackerSuggestJobStore.jobs).toEqual([])
    })

    it('log delta appends, and tolerates a job whose log arrived as null', () => {
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'a', log: null as unknown as string[] }))
        trackerSuggestJobStore.applyEvent({ type: 'log', id: 'a', line: 'first' })
        trackerSuggestJobStore.applyEvent({ type: 'log', id: 'a', line: 'second' })
        expect(trackerSuggestJobStore.jobs[0].log).toEqual(['first', 'second'])
    })

    it('log is capped at 300 lines, dropping the oldest', () => {
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'a', log: [] }))
        for (let i = 0; i < 305; i++) {
            trackerSuggestJobStore.applyEvent({ type: 'log', id: 'a', line: `line-${i}` })
        }
        const log = trackerSuggestJobStore.jobs[0].log
        expect(log).toHaveLength(300)
        expect(log[0]).toBe('line-5')          // oldest 5 trimmed
        expect(log[299]).toBe('line-304')      // newest kept
    })

    it('an over-cap log inherited from a snapshot is trimmed on the next log delta', () => {
        const bigLog = Array.from({ length: 450 }, (_, i) => `old-${i}`)
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'a', log: bigLog }))
        trackerSuggestJobStore.applyEvent({ type: 'log', id: 'a', line: 'new' })
        const log = trackerSuggestJobStore.jobs[0].log
        expect(log).toHaveLength(300)
        expect(log[299]).toBe('new')
        expect(log[0]).toBe('old-151')         // 451 - 300 = 151 trimmed
    })

    it('activeCount stays consistent through a burst of interleaved events', () => {
        for (let i = 0; i < 20; i++) trackerSuggestJobStore.applyEvent(makeTJob({ id: `j${i}`, status: 'pending' }))
        for (let i = 0; i < 10; i++) trackerSuggestJobStore.applyEvent(makeTJob({ id: `j${i}`, status: 'done' }))
        for (let i = 10; i < 15; i++) trackerSuggestJobStore.applyEvent(makeTJob({ id: `j${i}`, status: 'running' }))
        expect(trackerSuggestJobStore.jobs).toHaveLength(20)
        expect(trackerSuggestJobStore.activeCount).toBe(10)      // 5 running + 5 still pending
    })
})

// ── fetchAll ──────────────────────────────────────────────────────────────────

describe('fetchAll', () => {
    it('CONTRACT: a network failure REJECTS — no try/catch here, unlike guide-jobs.fetchAll', () => {
        // guide-jobs.svelte.ts:41-46 swallows; tracker-suggest-jobs.svelte.ts:124-129
        // does not. Callers that copy the guide-jobs calling pattern get an unhandled
        // rejection. Documented actual behavior.
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
        return expect(trackerSuggestJobStore.fetchAll()).rejects.toThrow('offline')
    })

    it('HTTP error resolves quietly and leaves jobs untouched', async () => {
        trackerSuggestJobStore.jobs = [makeTJob()]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, false, 503)))
        await trackerSuggestJobStore.fetchAll()
        expect(trackerSuggestJobStore.jobs).toHaveLength(1)
    })

    // REGRESSION: fetchAll() once assigned the response unconditionally, so a slow
    // response overwrote any live event that arrived while it was in flight and the job
    // regressed (e.g. done → running). Now a slow fetchAll no longer clobbers a fresher
    // stream update.
    it('a slow fetchAll response must not clobber a fresher stream update (regression)', async () => {
        const slow = deferred<Response>()
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(slow.promise))

        const pending = trackerSuggestJobStore.fetchAll()
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'a', status: 'done', trackers: [{ title: 'Bosses' }] }))
        slow.resolve(jsonResponse([makeTJob({ id: 'a', status: 'running', trackers: null })]))
        await pending

        expect(trackerSuggestJobStore.jobs[0].status).toBe('done')
        expect(trackerSuggestJobStore.jobs[0].trackers).not.toBeNull()
    })
})

// ── enqueue ───────────────────────────────────────────────────────────────────

describe('enqueue', () => {
    it('applies the returned job to the store', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(makeTJob({ id: 'new' }))))
        const job = await trackerSuggestJobStore.enqueue({ steamId: '620', gameName: 'Portal 2' })
        expect(job.id).toBe('new')
        expect(trackerSuggestJobStore.jobs.map(j => j.id)).toEqual(['new'])
    })

    it('HTTP error throws with the status and leaves jobs unchanged', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, false, 409)))
        await expect(
            trackerSuggestJobStore.enqueue({ steamId: '620', gameName: 'Portal 2' })
        ).rejects.toThrow('Enqueue failed: HTTP 409')
        expect(trackerSuggestJobStore.jobs).toEqual([])
    })

    // REGRESSION: enqueue() once blindly applyEvent()'d the POST response, so when the
    // shared stream had already delivered a NEWER state for the same job (POST response
    // raced the SSE 'running' event and lost), the stale 'pending' snapshot clobbered it.
    // Now it no longer regresses a job the stream already advanced (matching guide-jobs.enqueue).
    it('enqueue response must not regress a job the stream already advanced (regression)', async () => {
        const slow = deferred<Response>()
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(slow.promise))

        const p = trackerSuggestJobStore.enqueue({ steamId: '620', gameName: 'Portal 2' })
        // Stream beats the POST response:
        trackerSuggestJobStore.applyEvent(makeTJob({ id: 'race', status: 'running', progress: 30, log: ['searching…'] }))
        slow.resolve(jsonResponse(makeTJob({ id: 'race', status: 'pending', progress: 0 })))
        await p

        expect(trackerSuggestJobStore.jobs).toHaveLength(1)
        expect(trackerSuggestJobStore.jobs[0].status).toBe('running')
        expect(trackerSuggestJobStore.jobs[0].progress).toBe(30)
    })

    it('CONTRACT: a late enqueue response resurrects a job a snapshot has since removed', async () => {
        // Zombie row: snapshot empties the list mid-flight, then the POST response
        // lands and applyEvent re-inserts it. Cleared again by the next snapshot.
        const slow = deferred<Response>()
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(slow.promise))

        const p = trackerSuggestJobStore.enqueue({ steamId: '620', gameName: 'Portal 2' })
        trackerSuggestJobStore.applyEvent({ type: 'snapshot', jobs: [] })   // relay pruned everything
        slow.resolve(jsonResponse(makeTJob({ id: 'zombie' })))
        await p

        expect(trackerSuggestJobStore.jobs.map(j => j.id)).toEqual(['zombie'])
    })
})

// ── jobFor ────────────────────────────────────────────────────────────────────

describe('jobFor', () => {
    it('returns only pending/running jobs and coerces the caller argument to string', () => {
        trackerSuggestJobStore.jobs = [
            makeTJob({ id: 'd', steamId: '620', status: 'done' }),
            makeTJob({ id: 'p', steamId: '620', status: 'pending' }),
        ]
        // finished sibling does not shadow the active job (unlike guide-jobs.jobFor)
        expect(trackerSuggestJobStore.jobFor('620')?.id).toBe('p')
        expect(trackerSuggestJobStore.jobFor(620 as unknown as string)?.id).toBe('p')
    })

    it('returns undefined when the only job for the game is terminal', () => {
        trackerSuggestJobStore.jobs = [
            makeTJob({ id: 'd', status: 'done' }),
            makeTJob({ id: 'e', status: 'error' }),
            makeTJob({ id: 'c', status: 'cancelled' }),
        ]
        expect(trackerSuggestJobStore.jobFor('620')).toBeUndefined()
    })
})

// ── connect / stream / fan-out (fresh module instance per test) ───────────────

describe('connect', () => {
    beforeEach(() => {
        vi.stubGlobal('EventSource', FakeEventSource)
        vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    })

    it('without Web Locks, opens exactly one EventSource and is idempotent per tab', async () => {
        const store = await freshStore()
        store.connect()
        store.connect()
        store.connect()
        expect(FakeEventSource.instances).toHaveLength(1)
        expect(FakeEventSource.instances[0].url).toBe('/relay/api/progress-suggest/jobs/stream')
    })

    it('a valid stream message updates the store AND is fanned out to peers (but not echoed to self)', async () => {
        const store = await freshStore()
        store.connect()
        const ownChannel = FakeBroadcastChannel.all[0]
        const peerTab = new FakeBroadcastChannel('tracker-jobs')
        const peerReceived: unknown[] = []
        peerTab.onmessage = (e) => peerReceived.push(e.data)

        const job = makeTJob({ id: 'live-1', status: 'running' })
        FakeEventSource.instances[0].emit(job)

        expect(store.jobs.map(j => j.id)).toEqual(['live-1'])   // applied locally once
        expect(peerReceived).toHaveLength(1)                    // fanned out
        expect(ownChannel.posted).toHaveLength(1)
        expect(store.jobs).toHaveLength(1)                      // no self-echo double-apply
    })

    it('a message from another tab on the channel updates this store (follower path)', async () => {
        const store = await freshStore()
        store.connect()
        const otherTab = new FakeBroadcastChannel('tracker-jobs')
        otherTab.postMessage(makeTJob({ id: 'from-peer', status: 'running' }))
        expect(store.jobs.map(j => j.id)).toEqual(['from-peer'])
    })

    it('malformed SSE JSON is dropped: no state change, no broadcast, no throw', async () => {
        const store = await freshStore()
        store.connect()
        const ownChannel = FakeBroadcastChannel.all[0]
        expect(() => FakeEventSource.instances[0].emitRaw('{not json')).not.toThrow()
        expect(store.jobs).toEqual([])
        expect(ownChannel.posted).toEqual([])
    })

    it('CONTRACT: a JSON "null" payload is a local no-op but IS still broadcast to peers', async () => {
        // JSON.parse('null') succeeds, applyEvent(null) is guarded, but the
        // broadcast happens unconditionally (tracker-suggest-jobs.svelte.ts:116-117).
        // Harmless because every peer's applyEvent has the same guard.
        const store = await freshStore()
        store.connect()
        const ownChannel = FakeBroadcastChannel.all[0]
        FakeEventSource.instances[0].emitRaw('null')
        expect(store.jobs).toEqual([])
        expect(ownChannel.posted).toEqual([null])
    })

    it('BroadcastChannel being unavailable does not break the stream (leader-only mode)', async () => {
        vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('unsupported') } })
        const store = await freshStore()
        expect(() => store.connect()).not.toThrow()
        expect(FakeEventSource.instances).toHaveLength(1)
        FakeEventSource.instances[0].emit(makeTJob({ id: 'solo' }))     // postMessage is ?.-guarded
        expect(store.jobs.map(j => j.id)).toEqual(['solo'])
    })

    it('with Web Locks, requests the leader lock exclusively and opens the stream inside the grant', async () => {
        const request = vi.fn((_name: string, _opts: unknown, cb: () => Promise<void>) => cb())
        Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })

        const store = await freshStore()
        store.connect()
        await Promise.resolve()   // let the lock-grant microtask run

        expect(request).toHaveBeenCalledTimes(1)
        expect(request.mock.calls[0][0]).toBe('tracker-stream-leader')
        expect((request.mock.calls[0][1] as { mode: string }).mode).toBe('exclusive')
        expect(FakeEventSource.instances).toHaveLength(1)

        FakeEventSource.instances[0].emit(makeTJob({ id: 'leader-msg' }))
        expect(store.jobs.map(j => j.id)).toEqual(['leader-msg'])
    })

    it('when the lock is held by another tab, no EventSource opens until the grant (queued follower)', async () => {
        // request() queues: never invoke the callback — simulates another tab leading.
        const request = vi.fn(() => new Promise<void>(() => {}))
        Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })

        const store = await freshStore()
        store.connect()
        await Promise.resolve()

        expect(FakeEventSource.instances).toHaveLength(0)   // follower holds no stream
        // …but it still receives peer broadcasts:
        const otherTab = new FakeBroadcastChannel('tracker-jobs')
        otherTab.postMessage(makeTJob({ id: 'led-by-peer' }))
        expect(store.jobs.map(j => j.id)).toEqual(['led-by-peer'])
    })

    it('stream events arriving long after every consumer unsubscribed still mutate only the store (no throw)', async () => {
        // The store is app-lifetime; components come and go. Simulate teardown by
        // simply having no subscribers and firing late events — must not throw.
        const store = await freshStore()
        store.connect()
        const es = FakeEventSource.instances[0]
        es.emit(makeTJob({ id: 'late-1', status: 'running' }))
        es.emit(makeTJob({ id: 'late-1', status: 'done' }))
        expect(store.jobs[0].status).toBe('done')
        expect(store.activeCount).toBe(0)
    })
})
