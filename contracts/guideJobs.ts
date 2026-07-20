// Contract for the guide download job queue (guides/downloading.md, guides/refreshing.md):
//   GET    /relay/api/guides/jobs         — full in-memory job list
//   GET    /relay/api/guides/jobs/stream  — SSE, pushed on every job state change
//   POST   /relay/api/guides/jobs         — enqueue {steamId,source,guideId,url,gameName}, 202+Job
//   DELETE /relay/api/guides/jobs/{jobId} — cancel a pending job (running jobs can't be cancelled)
// Ported from guide-jobs.svelte.ts's own `Job` interface (relay-server holds no schema of its own —
// this is a plain in-memory object, confirmed against job-queue.js directly).
import { z } from 'zod'

export const GuideJobSchema = z.object({
    id:          z.string(),
    steamId:     z.string(),
    source:      z.string(),
    guideId:     z.string(),
    url:         z.string(),
    gameName:    z.string(),
    // 'reparse' re-runs parse-guide.js over the raw HTML already on disk, skipping the
    // fetch step — used to pick up parser/adapter fixes without re-hitting the source.
    // Optional: jobs enqueued before this field existed have no `mode`, and the queue
    // treats anything other than 'reparse' as a normal download.
    mode:        z.enum(['download', 'reparse']).optional(),
    status:      z.enum(['pending', 'running', 'done', 'error', 'cancelled']),
    progress:    z.object({ download: z.number(), pages: z.number(), subtask: z.number() }),
    log:         z.array(z.string()),
    createdAt:   z.string(),
    startedAt:   z.string().nullable(),
    completedAt: z.string().nullable(),
    error:       z.string().nullable(),
    sizeBytes:   z.number().nullable(),
})

export const GuideJobsResponseSchema = z.array(GuideJobSchema)

// applyEvent() in guide-jobs.svelte.ts branches on `data.type === 'snapshot'` (the initial
// hydration event, sent once per stream connection) vs. a bare Job object (every subsequent
// per-change push) — the Job type itself never carries a `type` field, so this union is
// structurally unambiguous.
export const GuideJobStreamEventSchema = z.union([
    z.object({ type: z.literal('snapshot'), jobs: z.array(GuideJobSchema) }),
    GuideJobSchema,
])

export const GuideJobCancelResponseSchema = z.object({ ok: z.boolean() })

export type GuideJob = z.infer<typeof GuideJobSchema>
export type GuideJobStreamEvent = z.infer<typeof GuideJobStreamEventSchema>
