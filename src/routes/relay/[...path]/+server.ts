// Catch-all /relay/* → relay-server proxy.
//
// Fold-in note (docs/relay-fold-in.md): migrated features define concrete
// routes under src/routes/relay/api/<feature>/ which take precedence over this
// rest-param route — SvelteKit always prefers the more specific match. This
// catch-all keeps serving whatever has NOT been migrated yet, and is removed
// (or kept as a dev forwarding convenience) at decommission.

import type { RequestEvent } from '@sveltejs/kit'
import { forwardToRelay } from '$lib/server/relay/shared/forward.js'

function relayBase(): string {
    return process.env.RELAY_URL ?? 'http://localhost:8050'
}

const proxy = (event: RequestEvent) => forwardToRelay(event, relayBase())

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
