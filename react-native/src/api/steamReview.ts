import { apiGet } from './client'
import { SteamReviewResponseSchema } from 'gaming-journal-contracts/steamReview'

// Confirmed live (both a game with a real review and one without, e.g. appid 220): this endpoint
// always returns a real 200, with `review: null` for "no Steam review written" — NOT a 404, unlike
// contracts/localReview.ts's endpoint. Uses apiGet, not apiGetOrNull.
export async function getSteamReview(appid: number) {
    return apiGet(`/relay/api/steam/reviews/${appid}`, SteamReviewResponseSchema)
}
