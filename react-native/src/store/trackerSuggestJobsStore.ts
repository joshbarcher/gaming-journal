// Port of tracker-suggest-jobs.svelte.ts's `trackerSuggestJobStore` singleton — app-global, same
// shape/pattern as `guideJobsStore.ts` (a job enqueued from the Journal dashboard's ✦ button needs
// to still show up later on the Downloads screen).
import { create } from 'zustand'

import { cancelTrackerSuggestJob, enqueueTrackerSuggestJob, getTrackerSuggestJobs } from '@/api/trackerSuggest'
import type { TrackerSuggestJob, TrackerSuggestJobStreamEvent } from 'gaming-journal-contracts/trackerSuggest'

type TrackerSuggestJobsState = {
    jobs: TrackerSuggestJob[]
    applyEvent: (event: TrackerSuggestJobStreamEvent) => void
    fetchAll: () => Promise<void>
    enqueue: (params: { steamId: string; gameName: string }) => Promise<TrackerSuggestJob>
    cancel: (jobId: string) => Promise<void>
    // Matches the web's own `jobFor(steamId)` exactly — only steamId, no source/guideId (this job
    // type is per-game, not per-guide) — finds any currently active (pending/running) job.
    jobFor: (steamId: string) => TrackerSuggestJob | undefined
}

export const useTrackerSuggestJobsStore = create<TrackerSuggestJobsState>((set, get) => ({
    jobs: [],

    applyEvent: (event) => {
        if ('type' in event && event.type === 'snapshot') {
            set({ jobs: event.jobs })
            return
        }
        const job = event as TrackerSuggestJob
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
            set({ jobs: await getTrackerSuggestJobs() })
        } catch { /* silent, matching the web's own best-effort fetchAll */ }
    },

    enqueue: async (params) => {
        const job = await enqueueTrackerSuggestJob(params)
        set(state => {
            const idx = state.jobs.findIndex(j => j.id === job.id)
            if (idx === -1) return { jobs: [...state.jobs, job] }
            return state
        })
        return job
    },

    cancel: async (jobId) => {
        await cancelTrackerSuggestJob(jobId)
    },

    jobFor: (steamId) =>
        get().jobs.find(j => j.steamId === String(steamId) && (j.status === 'pending' || j.status === 'running')),
}))
