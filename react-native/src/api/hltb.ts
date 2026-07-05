import { apiGet } from './client'
import { HltbIndexSchema } from 'gaming-journal-contracts/hltb'

export async function getHltbIndex() {
    return apiGet('/relay/api/hltb', HltbIndexSchema)
}
