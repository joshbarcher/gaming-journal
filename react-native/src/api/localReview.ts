import { apiGet, apiGetOrNull, apiPut } from './client'
import { AllLocalReviewsSchema, LocalReviewSchema, type LocalReview } from 'gaming-journal-contracts/localReview'

export async function getLocalReview(appid: number) {
    return apiGetOrNull(`/api/local-reviews/${appid}`, LocalReviewSchema)
}

// All reviews at once, keyed by appid string — account/my-reviews.md's grid.
export const getAllLocalReviews = () => apiGet('/api/local-reviews', AllLocalReviewsSchema)

// PUT returns the full saved review object (confirmed by reading
// src/routes/api/local-reviews/[appid]/+server.ts directly), matching openReviewModal()'s save flow.
export async function putLocalReview(appid: number, payload: Omit<LocalReview, 'updatedAt'>): Promise<LocalReview> {
    return apiPut(`/api/local-reviews/${appid}`, LocalReviewSchema, payload)
}
