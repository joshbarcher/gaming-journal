import { apiGet } from './client'
import { FlagsStoreSchema, type FlagsStore } from 'gaming-journal-contracts/flags'

// SvelteKit's own route (not relay-proxied) — game flags (favorite/inProgress/backlog/dropped/
// completed/etc.) keyed by appid string.
export async function getFlags(): Promise<FlagsStore> {
    return apiGet('/api/flags', FlagsStoreSchema)
}
