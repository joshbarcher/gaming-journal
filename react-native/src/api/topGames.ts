import { z } from 'zod'
import { apiDelete, apiGet, apiPost } from './client'
import { TopGamesResponseSchema } from 'gaming-journal-contracts/topGames'

export async function getTopGames(n = 100) {
    return apiGet(`/relay/api/player-counts/top?n=${n}&includeFiltered=true`, TopGamesResponseSchema)
}

// The web source (TopGames.svelte:63-69) never parses this response body — it only checks
// `res.ok`, then mutates local state directly. Matched that here (permissive z.unknown() schema)
// rather than guessing a response shape and test-writing to a real mutating endpoint just to see
// what comes back, per the standing rule against testing PUT/POST/DELETE with synthetic data
// against real state.
const UnknownSchema = z.unknown()

export async function setTopGameFiltered(appid: number, filtered: boolean) {
    return filtered
        ? apiPost(`/relay/api/player-counts/filtered/${appid}`, UnknownSchema)
        : apiDelete(`/relay/api/player-counts/filtered/${appid}`, UnknownSchema)
}
