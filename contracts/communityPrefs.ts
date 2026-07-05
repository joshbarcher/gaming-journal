// Contract for GET /api/community-prefs and POST /api/community-prefs/toggle — this app's own
// SvelteKit routes (not relay-proxied). Confirmed live: filtered/muted/favorited are flat
// username arrays; highlighted is keyed by appid (string) to an array of usernames, since a
// highlight is scoped to "this game" per community.md, unlike the other three which are global.
import { z } from 'zod'

export const CommunityPrefsSchema = z.object({
    filtered:    z.array(z.string()),
    muted:       z.array(z.string()),
    favorited:   z.array(z.string()),
    highlighted: z.record(z.string(), z.array(z.string())),
})

export const TogglePrefResponseSchema = z.object({
    active: z.boolean(),
})

export type CommunityPrefs      = z.infer<typeof CommunityPrefsSchema>
export type TogglePrefResponse  = z.infer<typeof TogglePrefResponseSchema>
