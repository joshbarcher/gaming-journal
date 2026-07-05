import { apiGet } from './client'
import { AccountSessionsResponseSchema } from 'gaming-journal-contracts/journalSessions'
import { ReleasesResponseSchema, type UpcomingGame } from 'gaming-journal-contracts/releases'

// Full sessions record keyed by appid — unlike getGameSessions in api/journal.ts (scoped to one
// appid for the Journal dashboard), Calendar's play mode needs every game's sessions at once to
// build the whole month's day map.
export async function getAllSessions() {
    const res = await apiGet('/relay/api/account', AccountSessionsResponseSchema)
    return res.sessions ?? {}
}

export async function getUpcomingReleases(): Promise<UpcomingGame[]> {
    const res = await apiGet('/relay/api/steam/releases', ReleasesResponseSchema)
    return res.upcoming
}
