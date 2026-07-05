import { apiGet } from './client'
import { DiscoverSearchResultsSchema, type DiscoverItem, type DiscoverSearchResults } from 'gaming-journal-contracts/discoverSearch'
import { DiscoverFeaturedResponseSchema, DiscoverSectionSchema, type DiscoverSection } from 'gaming-journal-contracts/discoverFeatured'
import { OwnershipResponseSchema, type OwnershipEntry } from 'gaming-journal-contracts/ownership'

export async function searchGames(query: string): Promise<DiscoverItem[]> {
    const parsed = await apiGet(
        `/relay/api/discover/search?q=${encodeURIComponent(query)}&limit=8&offset=0`,
        DiscoverSearchResultsSchema,
    )
    return parsed.results
}

// Discover screen item: the full paginated search (40/page, not the 8-result global-search-overlay
// cap), returning the whole envelope (results + total) rather than just `.results`.
export const searchGamesPaged = (query: string, limit: number, offset: number): Promise<DiscoverSearchResults> =>
    apiGet(`/relay/api/discover/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`, DiscoverSearchResultsSchema)

export const getFeatured = () => apiGet('/relay/api/discover/featured', DiscoverFeaturedResponseSchema)

export const getFeaturedPage = (tab: string, page: number): Promise<DiscoverSection> =>
    apiGet(`/relay/api/discover/featured?tab=${encodeURIComponent(tab)}&page=${page}`, DiscoverSectionSchema)

export const getOwnership = (): Promise<OwnershipEntry[]> => apiGet('/relay/api/games/ownership', OwnershipResponseSchema)
