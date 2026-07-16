export interface TrackerSuggestJob {
    id:          string
    steamId:     string
    gameName:    string
    status:      'pending' | 'running' | 'done' | 'error' | 'cancelled'
    progress:    number
    log:         string[]
    trackers:    Record<string, unknown>[] | null
    createdAt:   string
    startedAt:   string | null
    completedAt: string | null
    error:       string | null
}

const CHANNEL = 'tracker-jobs'          // cross-tab fan-out
const LOCK    = 'tracker-stream-leader' // exactly one tab owns the EventSource
const LOG_CAP = 300

class TrackerSuggestJobStore {
    jobs = $state<TrackerSuggestJob[]>([])

    #bc: BroadcastChannel | null = null
    #started = false
    #releaseLeader: (() => void) | null = null

    // Bumped on every jobs mutation so an in-flight fetchAll can tell its response
    // went stale (a live stream event landed while it awaited) and drop it.
    #version = 0

    get activeCount() {
        return this.jobs.filter(j => j.status === 'pending' || j.status === 'running').length
    }

    /** Hydrate from SSR data so a fresh/refreshed page shows in-flight jobs on first paint. */
    seed(jobs: TrackerSuggestJob[] | null | undefined) {
        if (Array.isArray(jobs)) {
            this.#version++
            this.jobs = jobs
        }
    }

    applyEvent(data: any) {
        if (!data) return
        this.#version++

        // Full snapshot (sent by the relay on every EventSource connect).
        if (data.type === 'snapshot') {
            this.jobs = data.jobs ?? []
            return
        }

        // Lightweight per-line log delta.
        if (data.type === 'log') {
            const idx = this.jobs.findIndex(j => j.id === data.id)
            if (idx === -1) return
            const job = this.jobs[idx]
            const log = [...(job.log ?? []), data.line]
            if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP)
            const next = [...this.jobs]
            next[idx] = { ...job, log }
            this.jobs = next
            return
        }

        // Full job object (status/progress/trackers change).
        const idx = this.jobs.findIndex(j => j.id === data.id)
        if (idx === -1) {
            this.jobs = [...this.jobs, data]
        } else {
            const next = [...this.jobs]
            next[idx] = data
            this.jobs = next
        }
    }

    /**
     * Open ONE shared live monitor for the whole browser, regardless of how many
     * tabs are open. A single leader tab (elected via the Web Locks API) holds the
     * only EventSource and re-broadcasts every update over a BroadcastChannel;
     * every tab — including the leader — updates its store from that channel. If
     * the leader tab closes, the lock auto-releases and another tab takes over.
     *
     * This keeps us to a single relay connection (and one undici hop on the
     * SvelteKit->relay proxy) no matter the tab count — see docs/connections-update.md.
     * Idempotent per tab; safe to call from every page's onMount.
     */
    connect() {
        if (this.#started || typeof window === 'undefined') return
        this.#started = true

        try {
            this.#bc = new BroadcastChannel(CHANNEL)
            this.#bc.onmessage = (e) => this.applyEvent(e.data)
        } catch { /* BroadcastChannel unavailable — leader still works, just no fan-out */ }

        this.#becomeLeader()
    }

    #becomeLeader() {
        if (typeof navigator !== 'undefined' && 'locks' in navigator) {
            const ac = new AbortController()
            navigator.locks
                .request(LOCK, { mode: 'exclusive', signal: ac.signal }, () =>
                    // Holding this promise open = holding the lock = being the leader.
                    new Promise<void>((resolve) => {
                        const es = this.#openStream()
                        this.#releaseLeader = () => { es.close(); resolve() }
                    })
                )
                .catch(() => { /* AbortError if a queued request is cancelled — fine */ })
        } else {
            // No Web Locks (old browser): this tab holds its own stream. Worst case
            // is one connection per tab, i.e. the pre-existing behaviour.
            const es = this.#openStream()
            this.#releaseLeader = () => es.close()
        }
    }

    #openStream(): EventSource {
        const es = new EventSource('/relay/api/progress-suggest/jobs/stream')
        es.onmessage = (e) => {
            let data: any
            try { data = JSON.parse(e.data) } catch { return }
            this.applyEvent(data)         // leader's own store
            this.#bc?.postMessage(data)   // fan out to every other tab
        }
        // EventSource auto-reconnects on drop; the relay re-sends a snapshot on
        // reconnect, so state re-syncs without extra handling.
        return es
    }

    async fetchAll() {
        const before = this.#version
        const res = await fetch('/relay/api/progress-suggest/jobs')
        if (!res.ok) return
        const jobs: TrackerSuggestJob[] = await res.json()
        // Anything that mutated the store while we awaited is fresher than this list.
        if (this.#version !== before) return
        this.#version++
        this.jobs = jobs
    }

    async enqueue(params: { steamId: string; gameName: string }): Promise<TrackerSuggestJob> {
        const res = await fetch('/relay/api/progress-suggest/jobs', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(params),
        })
        if (!res.ok) throw new Error(`Enqueue failed: HTTP ${res.status}`)
        const job: TrackerSuggestJob = await res.json()
        // Insert-only (mirrors guide-jobs): if the stream already advanced this job past
        // 'pending' while the POST round-tripped, the stale response must not regress it.
        if (!this.jobs.some(j => j.id === job.id)) {
            this.#version++
            this.jobs = [...this.jobs, job]
        }
        return job
    }

    async cancel(jobId: string) {
        await fetch(`/relay/api/progress-suggest/jobs/${jobId}`, { method: 'DELETE' })
    }

    jobFor(steamId: string): TrackerSuggestJob | undefined {
        return this.jobs.find(j =>
            j.steamId === String(steamId) &&
            (j.status === 'pending' || j.status === 'running')
        )
    }
}

export const trackerSuggestJobStore = new TrackerSuggestJobStore()
