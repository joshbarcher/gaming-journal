// Contract for GET /relay/api/steam/reviews/{appid} — the user's own Steam review (MyReview.svelte).
// Confirmed live against ELDEN RING: `review` is null-able (no review written) alongside a
// `fetchedAt`/`gameName` envelope.
import { z } from 'zod'

export const SteamUserReviewSchema = z.object({
    voted_up:                  z.boolean(),
    review:                    z.string().optional(),
    timestamp_created:         z.number().optional(),
    votes_up:                  z.number().optional(),
    written_during_early_access: z.boolean().optional(),
    author: z.object({
        playtime_at_review: z.number().nullable().optional(),
    }).optional(),
})

export const SteamReviewResponseSchema = z.object({
    fetchedAt: z.string().optional(),
    gameName:  z.string().optional(),
    review:    SteamUserReviewSchema.nullable().optional(),
})

export type SteamUserReview     = z.infer<typeof SteamUserReviewSchema>
export type SteamReviewResponse = z.infer<typeof SteamReviewResponseSchema>
