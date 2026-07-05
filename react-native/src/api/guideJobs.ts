import { apiDelete, apiGet, apiPost } from './client'
import { getApiHost } from './config'
import { subscribeSSE } from './sse'
import {
    GuideJobCancelResponseSchema, GuideJobSchema, GuideJobStreamEventSchema,
    GuideJobsResponseSchema, type GuideJob, type GuideJobStreamEvent,
} from 'gaming-journal-contracts/guideJobs'

export const getGuideJobs = () => apiGet('/relay/api/guides/jobs', GuideJobsResponseSchema)

export const enqueueGuideJob = (params: { steamId: string; source: string; guideId: string; url: string; gameName?: string }) =>
    apiPost('/relay/api/guides/jobs', GuideJobSchema, params)

export const cancelGuideJob = (jobId: string) =>
    apiDelete(`/relay/api/guides/jobs/${jobId}`, GuideJobCancelResponseSchema)

// GET-based SSE (unlike guide search's POST-based stream) — no conflicting-request semantics to
// special-case, so this reuses the shared Phase 0 `subscribeSSE` client directly, unlike
// runGuideSearch() which needed its own bespoke reader for the 409 branch.
export function subscribeGuideJobs(handlers: { onEvent: (e: GuideJobStreamEvent) => void; onError?: (err: Error) => void }): () => void {
    let unsubscribe = () => {}
    getApiHost().then(host => {
        unsubscribe = subscribeSSE<GuideJobStreamEvent>(
            `${host}/relay/api/guides/jobs/stream`,
            { onEvent: raw => handlers.onEvent(GuideJobStreamEventSchema.parse(raw)), onError: handlers.onError },
        )
    })
    return () => unsubscribe()
}

export type { GuideJob }
