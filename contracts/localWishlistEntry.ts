// Contract for GET/POST/DELETE /api/local-wishlist/{appid} — confirmed live: GET returns
// {wishlisted: boolean}. Distinct from contracts/wishlist.ts (the full GET /relay/api/wishlist
// list used by the Wishlist screen).
import { z } from 'zod'

export const LocalWishlistEntrySchema = z.object({
    wishlisted: z.boolean(),
})

export type LocalWishlistEntry = z.infer<typeof LocalWishlistEntrySchema>
