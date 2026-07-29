// Reading the app's own relay data during SSR, without the loopback socket.
//
// The SSR loaders used to fetch http://127.0.0.1:$PORT/relay/api/… for data the
// very same process already holds in memory. That round-trip bought nothing and
// cost plenty: a connection whose pooled socket goes stale during any pause in
// browsing (the 2s hang — see internalFetch.ts), plus JSON serialize/parse and a
// second pass through SvelteKit's router, all on the critical render path. A
// single page render did this 10+ times.
//
// So: call the service directly. The one thing the HTTP path did that matters is
// honour RELAY_FORWARD (docs/relay-fold-in.md § Phase 1) — the documented
// cutover-rollback that proxies a feature upstream so dev reads never trigger
// local NAS writes. ssrRead keeps that: if a forward target is configured for
// the feature, it still goes over HTTP.

import { forwardTarget } from '$lib/server/relay/shared/route-helpers.js'
import { internalJson }  from '$lib/server/internalFetch.js'
import { journalRelayBase } from '$lib/server/journalRelayBase.js'
import logger from '$lib/server/logger.js'

/**
 * @param feature  relayRoute() feature name — decides whether RELAY_FORWARD applies
 * @param path     /api/… path used only when forwarding
 * @param local    in-process read; must be a function so nothing runs when forwarding
 *
 * Returns null on failure rather than throwing: the loaders render
 * last-known-good / empty state per card, and one unavailable service must never
 * turn into a 500 for the whole page.
 */
export async function ssrRead<T>(feature: string, path: string, local: () => Promise<T> | T): Promise<T | null> {
    if (forwardTarget(feature)) return internalJson<T>(`${journalRelayBase()}${path}`)
    try {
        return await local()
    } catch (err) {
        logger.warn(`[ssr] ${feature} read failed`, { err: err instanceof Error ? err.message : String(err) })
        return null
    }
}
