// GET /relay/api/hltb/:appid — one game's completion times.
// ?fetch=true triggers a background re-search (202 pending) when the entry is
// missing or unmatched — behind a per-appid cooldown so a user refreshing an
// unmatched page rapidly doesn't hammer HLTB (relay controller contract).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { getEntry, syncGame } from '$lib/server/relay/hltb/hltb.service.js'

const _onDemandCooldown = new Map<string, number>() // appid → last on-demand attempt
const ON_DEMAND_COOLDOWN_MS = 5 * 60 * 1000

export const GET = relayRoute('hltb', async ({ params, url }) => {
    const appid = params.appid!
    const entry = await getEntry(appid)

    const needsFetch  = !entry || !entry.matched
    const lastAttempt = _onDemandCooldown.get(appid) ?? 0
    const onCooldown  = (Date.now() - lastAttempt) < ON_DEMAND_COOLDOWN_MS

    if (url.searchParams.get('fetch') === 'true' && needsFetch && !onCooldown) {
        const steamName = url.searchParams.get('name') ?? undefined
        _onDemandCooldown.set(appid, Date.now())
        syncGame(appid, { steamName }).then(async (result: { entry?: { matched?: boolean } }) => {
            if (result?.entry?.matched) await rebuild('games')
        }).catch((err: unknown) => {
            logger.warn('[hltb] On-demand fetch failed', { appid, err: err instanceof Error ? err.message : String(err) })
        })
        return json({ status: 'pending' }, 202)
    }

    if (!entry) return json({ error: 'HLTB entry not cached' }, 404)
    return json(entry)
})
