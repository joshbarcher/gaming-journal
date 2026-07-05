// Contract for GET /api/local-reviews/{appid}. Verified: 404 when no review exists (not a 200 with
// an error body — checked the actual HTTP status across all 14 real favorite-flagged games, found a
// mix of both 200 and 404), 200 with this shape when one does.
//
// Extended for the Reviews section (Phase 2): the original schema (written for Favorites, which
// only needed `stars`) was missing `badges` and `notes` — both real, present fields confirmed live
// (ELDEN RING's real review has a `badges` map and an empty `notes` array) that just happened to be
// silently stripped by Zod's default unknown-key behavior rather than causing a validation failure.
import { z } from 'zod'

export const LocalReviewSchema = z.object({
    stars:     z.number(),
    ratings:   z.record(z.string(), z.number()).optional(),
    tags:      z.array(z.string()).optional(),
    badges:    z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
    notes:     z.array(z.unknown()).optional(),
    review:    z.string().optional(),
    updatedAt: z.string().optional(),
})

export type LocalReview = z.infer<typeof LocalReviewSchema>

// Contract for GET /api/local-reviews (no appid) — ALL stored reviews at once, keyed by appid
// string. Used by account/my-reviews.md's grid. Confirmed live: 41 real entries, same per-review
// shape as the single-appid endpoint above.
export const AllLocalReviewsSchema = z.record(z.string(), LocalReviewSchema)

export type AllLocalReviews = z.infer<typeof AllLocalReviewsSchema>
