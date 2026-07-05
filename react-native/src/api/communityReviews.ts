import { apiGetOrNull } from './client'
import { CommunityReviewsSchema } from 'gaming-journal-contracts/communityReviews'

export async function getCommunityReviews(appid: number) {
    return apiGetOrNull(`/relay/api/steam/community-reviews/${appid}`, CommunityReviewsSchema)
}
