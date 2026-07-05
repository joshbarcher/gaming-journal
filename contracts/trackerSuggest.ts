// Contract for the AI Auto-Trackers job queue (journal/auto-trackers.md):
//   GET    /relay/api/progress-suggest/jobs         — full in-memory job list
//   GET    /relay/api/progress-suggest/jobs/stream  — SSE, pushed on every job state change
//   POST   /relay/api/progress-suggest/jobs         — enqueue {steamId,gameName}, 200+Job
//                                                       (not 202 — confirmed via handleEnqueueJob,
//                                                       a real, minor difference from the guide
//                                                       job queue's 202)
//   DELETE /relay/api/progress-suggest/jobs/{jobId} — cancel a pending job
// Ported from tracker-suggest-jobs.svelte.ts's own `TrackerSuggestJob` interface.
import { z } from 'zod'

export const TrackerSuggestJobSchema = z.object({
    id:          z.string(),
    steamId:     z.string(),
    gameName:    z.string(),
    status:      z.enum(['pending', 'running', 'done', 'error', 'cancelled']),
    progress:    z.number(),
    log:         z.array(z.string()),
    trackers:    z.array(z.record(z.string(), z.unknown())).nullable(),
    createdAt:   z.string(),
    startedAt:   z.string().nullable(),
    completedAt: z.string().nullable(),
    error:       z.string().nullable(),
})

export const TrackerSuggestJobsResponseSchema = z.array(TrackerSuggestJobSchema)

// Same structural shape as GuideJobStreamEventSchema — a snapshot event vs. a bare Job, distinct
// because Job never carries a `type` field.
export const TrackerSuggestJobStreamEventSchema = z.union([
    z.object({ type: z.literal('snapshot'), jobs: z.array(TrackerSuggestJobSchema) }),
    TrackerSuggestJobSchema,
])

export const TrackerSuggestJobCancelResponseSchema = z.object({ ok: z.boolean() })

export type TrackerSuggestJob = z.infer<typeof TrackerSuggestJobSchema>
export type TrackerSuggestJobStreamEvent = z.infer<typeof TrackerSuggestJobStreamEventSchema>
