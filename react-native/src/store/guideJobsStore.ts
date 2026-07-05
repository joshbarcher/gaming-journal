// Port of guide-jobs.svelte.ts's `jobStore` singleton — an app-global job list (not a per-screen
// concern), since a job enqueued from the Guides modal on one screen needs to still show up on the
// Downloads screen later. Same shape: `jobs[]`, `applyEvent()` (snapshot vs. per-change upsert),
// `fetchAll()`, `enqueue()`, `cancel()`, `jobFor()`.
import { create } from 'zustand'

import { cancelGuideJob, enqueueGuideJob, getGuideJobs } from '@/api/guideJobs'
import type { GuideJob, GuideJobStreamEvent } from 'gaming-journal-contracts/guideJobs'

type GuideJobsState = {
    jobs: GuideJob[]
    activeCount: () => number
    applyEvent: (event: GuideJobStreamEvent) => void
    fetchAll: () => Promise<void>
    enqueue: (params: { steamId: string; source: string; guideId: string; url: string; gameName?: string }) => Promise<GuideJob>
    cancel: (jobId: string) => Promise<void>
    jobFor: (steamId: string, source: string, guideId: string) => GuideJob | undefined
}

export const useGuideJobsStore = create<GuideJobsState>((set, get) => ({
    jobs: [],
    activeCount: () => get().jobs.filter(j => j.status === 'pending' || j.status === 'running').length,

    applyEvent: (event) => {
        if ('type' in event && event.type === 'snapshot') {
            set({ jobs: event.jobs })
            return
        }
        const job = event as GuideJob
        set(state => {
            const idx = state.jobs.findIndex(j => j.id === job.id)
            if (idx === -1) return { jobs: [...state.jobs, job] }
            const next = [...state.jobs]
            next[idx] = job
            return { jobs: next }
        })
    },

    fetchAll: async () => {
        try {
            set({ jobs: await getGuideJobs() })
        } catch { /* silent, matching the web's own best-effort fetchAll */ }
    },

    enqueue: async (params) => {
        const job = await enqueueGuideJob(params)
        set(state => {
            const idx = state.jobs.findIndex(j => j.id === job.id)
            if (idx === -1) return { jobs: [...state.jobs, job] }
            return state
        })
        return job
    },

    cancel: async (jobId) => {
        await cancelGuideJob(jobId)
    },

    jobFor: (steamId, source, guideId) =>
        get().jobs.find(j => j.steamId === String(steamId) && j.source === source && j.guideId === guideId),
}))
