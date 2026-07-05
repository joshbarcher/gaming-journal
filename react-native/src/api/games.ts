import { apiGet } from './client'
// contracts/ is consumed as a local `file:` package (see package.json "gaming-journal-contracts"),
// symlinked into node_modules by npm — Metro resolves it exactly like any other dependency, no
// custom resolver config needed. Tried a raw cross-folder relative import + Metro watchFolders
// first; Metro's resolver wouldn't follow it reliably. The web app still uses SvelteKit's
// `$contracts` alias pointing at the same files — the two apps just reference them differently.
import { SteamGamesListSchema, type SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'

export async function getSteamGamesList(): Promise<SteamGameRaw[]> {
    const parsed = await apiGet('/relay/api/steam/games', SteamGamesListSchema)
    return parsed.games
}
