import { apiDelete, apiGet, apiPost } from './client'
import { getApiHost } from './config'
import { subscribeSSE } from './sse'
import {
    TrackerSuggestJobCancelResponseSchema, TrackerSuggestJobSchema, TrackerSuggestJobStreamEventSchema,
    TrackerSuggestJobsResponseSchema, type TrackerSuggestJob, type TrackerSuggestJobStreamEvent,
} from 'gaming-journal-contracts/trackerSuggest'

export const getTrackerSuggestJobs = () => apiGet('/relay/api/progress-suggest/jobs', TrackerSuggestJobsResponseSchema)

export const enqueueTrackerSuggestJob = (params: { steamId: string; gameName: string }) =>
    apiPost('/relay/api/progress-suggest/jobs', TrackerSuggestJobSchema, params)

export const cancelTrackerSuggestJob = (jobId: string) =>
    apiDelete(`/relay/api/progress-suggest/jobs/${jobId}`, TrackerSuggestJobCancelResponseSchema)

// GET-based SSE, same shape as the guide job stream — reuses the shared Phase 0 client directly.
export function subscribeTrackerSuggestJobs(handlers: { onEvent: (e: TrackerSuggestJobStreamEvent) => void; onError?: (err: Error) => void }): () => void {
    let unsubscribe = () => {}
    getApiHost().then(host => {
        unsubscribe = subscribeSSE<TrackerSuggestJobStreamEvent>(
            `${host}/relay/api/progress-suggest/jobs/stream`,
            { onEvent: raw => handlers.onEvent(TrackerSuggestJobStreamEventSchema.parse(raw)), onError: handlers.onError },
        )
    })
    return () => unsubscribe()
}

export type { TrackerSuggestJob }
