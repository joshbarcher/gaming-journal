// GET  /relay/api/guides/jobs — full in-memory job list
// POST /relay/api/guides/jobs — enqueue a download job (202 + job object)
// (ports relay guides.controller handleJobList / handleJobEnqueue).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getJobs, enqueueJob } from '$lib/server/relay/guides/job-queue.js'
import { getMeta } from '$lib/server/relay/guides/guides.controller.js'

export const GET = relayRoute('guides', async () => {
    return json(getJobs())
})

export const POST = relayRoute('guides', async ({ request }) => {
    const { steamId, source, guideId, url, gameName, mode } = await request.json().catch(() => ({})) ?? {}

    if (!steamId || !source || !guideId) {
        return json({ error: 'steamId, source, and guideId are required' }, 400)
    }

    // A reparse re-runs the parser over raw HTML already on disk, so the caller has no
    // reason to know the original URL — read it from the guide's own _meta.json (it is
    // carried on the job purely for display). Requiring it from the client would make
    // every caller re-fetch the guide's metadata just to press a button.
    if (mode === 'reparse') {
        const meta = await getMeta(String(steamId), source, guideId)
        if (meta.status !== 200) {
            return json({ error: 'Guide not found on disk — nothing to reparse' }, 404)
        }
        const job = enqueueJob({
            steamId: String(steamId), source, guideId,
            url: meta.body?.sourceUrl ?? '', gameName: gameName ?? meta.body?.title ?? '',
            mode: 'reparse',
        })
        return json(job, 202)
    }

    if (!url) {
        return json({ error: 'steamId, source, guideId, and url are required' }, 400)
    }
    if (!/^https?:\/\//.test(url)) {
        return json({ error: 'url must be an absolute https URL' }, 400)
    }

    const job = enqueueJob({ steamId: String(steamId), source, guideId, url, gameName })
    return json(job, 202)
})
