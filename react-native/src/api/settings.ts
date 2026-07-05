import { apiGet, apiPatch } from './client'
import { SettingsSchema, type Settings } from 'gaming-journal-contracts/settings'

// SvelteKit's own route (not relay-proxied) — showChildLocked/showFiltered gate the calendar's
// buildDayMap/buildLastPlayedOverlay filtering, same as they gate other flag-aware screens.
export const getSettings = (): Promise<Settings> => apiGet('/api/settings', SettingsSchema)

// PATCH returns the FULL updated settings object (confirmed by reading the real +server.ts route
// directly) — same one-changed-key-at-a-time save pattern as Settings.svelte's own onToggle()/
// saveBlocklist(), not a full-object PUT.
export const patchSettings = (changes: Partial<Settings>): Promise<Settings> =>
    apiPatch('/api/settings', SettingsSchema, changes)
