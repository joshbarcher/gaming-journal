import { z } from 'zod'

import { apiDelete, apiGet, apiPost, apiPut } from './client'
import { AchievementsResponseSchema } from 'gaming-journal-contracts/achievements'
import { AccountSessionsResponseSchema, type JournalSession } from 'gaming-journal-contracts/journalSessions'
import { PageSchema, PagesResponseSchema, type Page } from 'gaming-journal-contracts/pages'
import { JournalNotesResponseSchema, type StickyNote } from 'gaming-journal-contracts/journalNotes'
import { DownloadedGuidesResponseSchema } from 'gaming-journal-contracts/downloadedGuides'

export async function getGameAchievements(appid: number) {
    const res = await apiGet(`/relay/api/steam/achievements/${appid}`, AchievementsResponseSchema)
    return res.achievements ?? []
}

// Scoped to the `sessions[appid]` slice — the full /relay/api/account payload also carries
// profile/steam/stats/recentlyPlayed/mostPlayed, none of which the dashboard needs.
export async function getGameSessions(appid: number): Promise<JournalSession[]> {
    const res = await apiGet('/relay/api/account', AccountSessionsResponseSchema)
    return res.sessions?.[String(appid)]?.sessions ?? []
}

export const getJournalPages = (appid: number) => apiGet(`/api/pages?appid=${appid}`, PagesResponseSchema)
export const getJournalNotes = (appid: number) => apiGet(`/api/journal-notes/${appid}`, JournalNotesResponseSchema)
// PUT returns the saved array back (confirmed by reading the real +server.ts route directly) —
// the sticky-note wall saves its FULL notes array on every add/update/remove/reorder, matching
// JournalNotes.svelte's `_save()` calling `api.journalNotes.set(appid, wall.serialize())`.
export const setJournalNotes = (appid: number, notes: StickyNote[]) =>
    apiPut(`/api/journal-notes/${appid}`, JournalNotesResponseSchema, notes)
export const getDownloadedGuides = (appid: number) => apiGet(`/relay/api/guides/${appid}`, DownloadedGuidesResponseSchema)

// Page CRUD — confirmed by reading src/routes/api/pages/**/+server.ts directly: POST returns the
// created page (201), PUT returns the updated page, DELETE returns a bare 204.
export const getPage = (id: string) => apiGet(`/api/pages/${id}`, PageSchema)
export const createPage = (payload: { type: Page['type']; title: string; appid: string }) =>
    apiPost('/api/pages', PageSchema, payload)
// Widened from `Partial<Pick<Page, 'title'|'content'>>` (the Notes/Pages item's original, narrower
// scope) to `Partial<Omit<Page, 'id'|'type'>>` — tracker types (progress/progress-bars/counter/
// multi-counter) all PUT their own type-specific fields (tasks/bars/current/target/counters/notes)
// through this exact same endpoint, confirmed via trackers.md's "all persist to the same Page
// record schema via PUT /api/pages/{pageId}".
export const updatePage = (id: string, updates: Partial<Omit<Page, 'id' | 'type'>>) =>
    apiPut(`/api/pages/${id}`, PageSchema, updates)
export const deletePage = (id: string) => apiDelete(`/api/pages/${id}`, z.unknown())
