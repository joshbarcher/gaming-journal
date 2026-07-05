// Contract for GET /relay/api/steam/community-reviews/{appid}. Originally scoped to just the hero
// chip's needs (score description + ratio) — extended for the Reviews section (Phase 2) to include
// the individual `reviews[]` list CommunityReviews.svelte actually renders, confirmed live against
// ELDEN RING (100 real cached reviews with real vote/hour/text data).
import { z } from 'zod'

export const CommunityReviewEntrySchema = z.object({
    id:            z.string().optional(),
    votedUp:       z.boolean().optional(),
    postedAt:      z.string().optional(),
    hoursAtReview: z.number().nullable().optional(),
    hoursTotal:    z.number().nullable().optional(),
    votesUp:       z.number().optional(),
    votesFunny:    z.number().optional(),
    commentCount:  z.number().optional(),
    earlyAccess:   z.boolean().optional(),
    text:          z.string().optional(),
})

export const CommunityReviewsSchema = z.object({
    appid:        z.number().optional(),
    checkedAt:    z.string().optional(),
    totalReviews: z.number().optional(),
    reviewCount:  z.number().optional(),
    summary: z.object({
        totalPositive: z.number().optional(),
        totalNegative: z.number().optional(),
        scoreDesc:     z.string().optional(),
        ratio:         z.number().optional(),
    }).optional(),
    reviews: z.array(CommunityReviewEntrySchema).optional(),
})

export type CommunityReviewEntry = z.infer<typeof CommunityReviewEntrySchema>
export type CommunityReviews     = z.infer<typeof CommunityReviewsSchema>
