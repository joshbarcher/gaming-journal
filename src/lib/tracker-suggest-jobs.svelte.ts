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

class TrackerSuggestJobStore {
    jobs = $state<TrackerSuggestJob[]>([])

    get activeCount() {
        return this.jobs.filter(j => j.status === 'pending' || j.status === 'running').length
    }

    applyEvent(data: any) {
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
        const res = await fetch('/relay/api/progress-suggest/jobs')
        if (!res.ok) return
        const jobs: TrackerSuggestJob[] = await res.json()
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
        const idx = this.jobs.findIndex(j => j.id === job.id)
        if (idx === -1) this.jobs = [...this.jobs, job]
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
