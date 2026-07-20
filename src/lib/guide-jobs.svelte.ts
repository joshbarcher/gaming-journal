export interface Job {
    id:          string
    steamId:     string
    source:      string
    guideId:     string
    url:         string
    gameName:    string
    // 'reparse' re-runs the parser over raw HTML already on disk, skipping the fetch
    // step. Optional: jobs enqueued before this field existed carry no `mode`, and
    // anything other than 'reparse' is treated as a normal download.
    mode?:       'download' | 'reparse'
    status:      'pending' | 'running' | 'done' | 'error' | 'cancelled'
    progress:    { download: number; pages: number; subtask: number }
    log:         string[]
    createdAt:   string
    startedAt:   string | null
    completedAt: string | null
    error:       string | null
    sizeBytes:   number | null
}

class GuideJobStore {
    jobs = $state<Job[]>([])

    // Bumped on every jobs mutation so an in-flight fetchAll can tell its response
    // went stale (a live SSE event landed while it awaited) and drop it.
    #version = 0

    get activeCount() {
        return this.jobs.filter(j => j.status === 'pending' || j.status === 'running').length
    }

    applyEvent(data: any) {
        if (!data) return
        this.#version++
        if (data.type === 'snapshot') {
            this.jobs = data.jobs ?? []
        } else {
            const idx = this.jobs.findIndex(j => j.id === data.id)
            if (idx === -1) {
                this.jobs = [...this.jobs, data]
            } else {
                const next = [...this.jobs]
                next[idx] = data
                this.jobs = next
            }
        }
    }

    async fetchAll() {
        try {
            const before = this.#version
            const res = await fetch('/relay/api/guides/jobs')
            if (!res.ok) return
            const jobs = await res.json()
            // Anything that mutated the store while we awaited is fresher than this list.
            if (this.#version !== before) return
            this.#version++
            this.jobs = jobs
        } catch { /* silent */ }
    }

    async enqueue(params: { steamId: string; source: string; guideId: string; url: string; gameName?: string }) {
        const res = await fetch('/relay/api/guides/jobs', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(params),
        })
        if (!res.ok) throw new Error(`Enqueue failed: HTTP ${res.status}`)
        const job: Job = await res.json()
        const idx = this.jobs.findIndex(j => j.id === job.id)
        if (idx === -1) {
            this.#version++
            this.jobs = [...this.jobs, job]
        }
        return job
    }

    async cancel(jobId: string) {
        await fetch(`/relay/api/guides/jobs/${jobId}`, { method: 'DELETE' })
    }

    jobFor(steamId: string, source: string, guideId: string): Job | undefined {
        // Active jobs only — a finished job for the same guide must not shadow a
        // re-queued one (callers use this as the "already downloading?" guard).
        return this.jobs.find(j =>
            (j.status === 'pending' || j.status === 'running') &&
            j.steamId === String(steamId) &&
            j.source  === source &&
            j.guideId === guideId
        )
    }
}

export const jobStore = new GuideJobStore()
