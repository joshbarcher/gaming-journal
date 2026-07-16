// DELETE /relay/api/guides/jobs/:jobId — cancel a pending job
// (ports relay guides.controller handleJobCancel; running jobs can't cancel).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { cancelJob } from '$lib/server/relay/guides/job-queue.js'

export const DELETE = relayRoute('guides', async ({ params }) => {
    const ok = cancelJob(params.jobId)
    if (!ok) return json({ error: 'Job not found or not cancellable' }, 409)
    return json({ ok: true })
})
