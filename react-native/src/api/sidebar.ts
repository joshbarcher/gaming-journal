import { apiGet } from './client'
import { NowPlayingSchema, type NowPlaying } from 'gaming-journal-contracts/nowPlaying'

export async function getNowPlaying(): Promise<NowPlaying> {
    return apiGet('/relay/api/steam/now-playing', NowPlayingSchema)
}
