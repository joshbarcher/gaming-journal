export interface Job {
    id:          string
    steamId:     string
    source:      string
    guideId:     string
    url:         string
    gameName:    string
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
    #es: EventSource | null = null

    get activeCount() {
        return this.jobs.filter(j => j.status === 'pending' || j.status === 'running').length
    }

    connect() {
        if (this.#es) return
        const es = new EventSource('/relay/api/guides/jobs/stream')
        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data)
                if (data.type === 'snapshot') {
                    this.jobs = data.jobs
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
            } catch { /* malformed */ }
        }
        this.#es = es
    }

    disconnect() {
        this.#es?.close()
        this.#es = null
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
        if (idx === -1) this.jobs = [...this.jobs, job]
        return job
    }

    async cancel(jobId: string) {
        await fetch(`/relay/api/guides/jobs/${jobId}`, { method: 'DELETE' })
    }

    jobFor(steamId: string, source: string, guideId: string): Job | undefined {
        return this.jobs.find(j =>
            j.steamId === String(steamId) &&
            j.source  === source &&
            j.guideId === guideId
        )
    }
}

export const jobStore = new GuideJobStore()
