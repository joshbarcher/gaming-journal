import { apiGet } from './client'
import { RelayGamesListSchema } from 'gaming-journal-contracts/relayGames'

// GET /relay/api/games — used only by the Franchise detail screen (ownership/wishlist
// partitioning + hero-slideshow screenshots). Distinct from getSteamGamesList(), which hits the
// separate /relay/api/steam/games endpoint the Franchises list screen uses instead.
export const getRelayGames = () => apiGet('/relay/api/games', RelayGamesListSchema)
