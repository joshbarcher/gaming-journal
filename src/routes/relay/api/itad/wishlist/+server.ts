// GET /relay/api/itad/wishlist — wishlist items joined with cached ITAD prices.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getWishlistEntries } from '$lib/server/relay/itad/itad.service.js'

export const GET = relayRoute('itad', async () => json(await getWishlistEntries()))
