import { apiGet } from './client'
import { WishlistResponseSchema } from 'gaming-journal-contracts/wishlist'

export async function getWishlist() {
    return apiGet('/relay/api/wishlist', WishlistResponseSchema)
}
