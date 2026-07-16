// DELETE /relay/api/progress-suggest/jobs/:jobId — cancel a pending job
// (ports relay progress-suggest.controller handleCancelJob; running jobs are
// not cancellable — the CLI process is already in flight).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { cancelJob } from '$lib/server/relay/progress-suggest/suggest-job-queue.js'

export const DELETE = relayRoute('progress-suggest', ({ params }) => {
    const ok = cancelJob(params.jobId!)
    if (ok) return json({ ok: true })
    return json({ error: 'Job not found or not cancellable' }, 404)
})
