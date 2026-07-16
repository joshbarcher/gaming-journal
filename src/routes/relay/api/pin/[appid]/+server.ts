// POST /relay/api/pin/:appid — manual pin, body { name } (ports relay
// pin.controller handleSetPin, including its exact status bodies).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import * as pin from '$lib/server/relay/pin/pin.service.js'

export const POST = relayRoute('pin', async ({ params, request }) => {
    try {
        const appid = Number(params.appid)
        // express.json() left req.body undefined on an empty/non-JSON body —
        // the optional-chain below then 400s; mirrored here with a null catch.
        const body: { name?: string } | null = await request.json().catch(() => null)
        const name  = body?.name
        if (!appid || !name) return json({ error: 'appid and name required' }, 400)

        await pin.set(appid, name, 'manual')
        return json(pin.get())
    } catch (err) {
        logger.error('[pin] Set failed', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
