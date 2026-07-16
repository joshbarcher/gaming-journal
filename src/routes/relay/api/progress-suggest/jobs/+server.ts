// /relay/api/progress-suggest/jobs — tracker-suggest job queue
// (ports relay progress-suggest.controller handleListJobs / handleEnqueueJob).
//   GET  — list all jobs (snapshot)
//   POST — enqueue { steamId, gameName }; deduplicates against active jobs
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getJobs, enqueueJob } from '$lib/server/relay/progress-suggest/suggest-job-queue.js'

export const GET = relayRoute('progress-suggest', () => {
    return json(getJobs())
})

export const POST = relayRoute('progress-suggest', async ({ request }) => {
    const body = await request.json().catch(() => null) as { steamId?: unknown, gameName?: string } | null
    const { steamId, gameName } = body ?? {}
    if (!steamId || !gameName) return json({ error: 'steamId and gameName are required' }, 400)
    const job = enqueueJob({ steamId: String(steamId), gameName })
    return json(job)
})
