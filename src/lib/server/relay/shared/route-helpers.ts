// Route wrapper for migrated relay features (docs/relay-fold-in.md § Phase 1).
//
// relayRoute('itad', handler) serves the request locally UNLESS a forward
// target applies, in which case the request is proxied upstream unchanged:
//
//   RELAY_FORWARD_<FEATURE>=<url>   → forward this feature (cutover rollback)
//   RELAY_FORWARD_<FEATURE>=local   → force local, overriding the global flag
//   RELAY_FORWARD=<url>             → forward every wrapped feature (dev default:
//                                     point at the prod journal so dev reads never
//                                     trigger local NAS writes via syncOne)
//   (neither set)                   → serve locally (prod default)
//
// Local handlers follow the relay controller contract: return a Response;
// thrown errors are logged and become a 500 JSON body here — feature code
// only encodes its intentional statuses (200 / 202-pending / 404 / 409-busy).

import type { RequestEvent, RequestHandler } from '@sveltejs/kit'
import logger from '../../logger.js'
import { forwardToRelay } from './forward.js'

export function forwardTarget(feature: string): string | null {
    const per = process.env[`RELAY_FORWARD_${feature.toUpperCase().replace(/-/g, '_')}`]
    if (per === 'local') return null
    if (per) return per
    return process.env.RELAY_FORWARD || null
}

type Handler = (event: RequestEvent) => Promise<Response> | Response

export function relayRoute(feature: string, handler: Handler): RequestHandler {
    return async (event: RequestEvent) => {
        const target = forwardTarget(feature)
        if (target) return forwardToRelay(event, target)
        try {
            return await handler(event)
        } catch (err) {
            logger.error(`[relay/${feature}] ${event.request.method} ${event.url.pathname} failed`, { err: err instanceof Error ? err.message : String(err) })
            return json({ error: 'Internal server error' }, 500)
        }
    }
}

/** Small helper mirroring express `res.status(n).json(x)` for ported controllers. */
export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
