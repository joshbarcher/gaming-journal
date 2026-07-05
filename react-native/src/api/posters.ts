import { apiGet } from './client'
import { PostersResponseSchema, type PosterItem } from 'gaming-journal-contracts/posters'

export async function getPosters(source: 'library' | 'wishlist', n = 50): Promise<PosterItem[]> {
    return apiGet(`/relay/api/games/posters?source=${source}&n=${n}`, PostersResponseSchema)
}
