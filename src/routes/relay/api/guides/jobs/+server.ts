// GET  /relay/api/guides/jobs — full in-memory job list
// POST /relay/api/guides/jobs — enqueue a download job (202 + job object)
// (ports relay guides.controller handleJobList / handleJobEnqueue).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getJobs, enqueueJob } from '$lib/server/relay/guides/job-queue.js'

export const GET = relayRoute('guides', async () => {
    return json(getJobs())
})

export const POST = relayRoute('guides', async ({ request }) => {
    const { steamId, source, guideId, url, gameName } = await request.json().catch(() => ({})) ?? {}

    if (!steamId || !source || !guideId || !url) {
        return json({ error: 'steamId, source, guideId, and url are required' }, 400)
    }
    if (!/^https?:\/\//.test(url)) {
        return json({ error: 'url must be an absolute https URL' }, 400)
    }

    const job = enqueueJob({ steamId: String(steamId), source, guideId, url, gameName })
    return json(job, 202)
})
