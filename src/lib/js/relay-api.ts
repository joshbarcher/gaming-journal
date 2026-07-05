// Thin, validated wrapper around relay-server endpoints proxied through /relay/*.
// Unlike src/lib/js/api.ts (which hits this app's own /api/* routes), these calls
// cross into relay-server's data and are validated against contracts/ — a schema
// mismatch throws immediately instead of surfacing as a silent `undefined` deep in
// a component.
import { SteamGamesListSchema, type SteamGameRaw } from '$contracts/steamGamesList.js'

const RELAY_BASE = '/relay/api'

export async function getSteamGamesList(): Promise<SteamGameRaw[]> {
    const res = await fetch(`${RELAY_BASE}/steam/games`)
    if (!res.ok) throw new Error(`Games HTTP ${res.status}`)
    const json = await res.json()
    const parsed = SteamGamesListSchema.parse(json)
    return parsed.games
}
