import { apiPost } from './client'
import { RecommendResponseSchema, type RecommendDepth } from 'gaming-journal-contracts/recommend'

export const postRecommend = (payload: {
    depth: RecommendDepth
    sequence?: string[]
    filters: { type: string; value: string | null }[]
}) => apiPost('/relay/api/recommend', RecommendResponseSchema, payload)
