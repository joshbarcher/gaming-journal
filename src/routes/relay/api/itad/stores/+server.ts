// GET /relay/api/itad/stores — the opt-in store list.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { STORES } from '$lib/server/relay/itad/itad.service.js'

export const GET = relayRoute('itad', () => json(STORES))
