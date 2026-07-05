import { apiGet } from './client'
import { HomeDataSchema, type HomeData } from 'gaming-journal-contracts/home'

export async function getHomeData(): Promise<HomeData> {
    return apiGet('/relay/api/home', HomeDataSchema)
}
