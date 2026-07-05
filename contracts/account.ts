// Contract for GET /relay/api/account (account/account.md) — the full payload, not just the
// `sessions` slice already modeled in journalSessions.ts (that one is scoped to the Journal
// dashboard's needs; this covers the whole Account screen: profile/steam/stats/recentlyPlayed/
// mostPlayed too). Verified against a real live payload rather than the doc alone: `memberSince`
// is a bare YEAR NUMBER (`2009`), not an ISO string as types.ts's `AccountProfile.memberSince?:
// string` claims — kept as `z.union([z.string(), z.number()])` since the real Svelte template just
// interpolates it directly (`Member since {profile.memberSince ?? '?'}`), which works identically
// for either. `steam` also carries `xpToNext`/`badgeCount` beyond what the web's own AccountSteam
// type declares — kept as optional extras rather than dropped.
import { z } from 'zod'

export const AccountProfileSchema = z.object({
    name:        z.string(),
    realName:    z.string().optional(),
    avatar:      z.string().optional(),
    memberSince: z.union([z.string(), z.number()]).optional(),
    lastLogoff:  z.string().optional(),
    profileUrl:  z.string().optional(),
})

export const AccountSteamSchema = z.object({
    level:     z.number().optional(),
    xp:        z.number().optional(),
    xpToNext:  z.number().optional(),
    badgeCount: z.number().optional(),
})

export const AccountStatsSchema = z.object({
    totalHoursPlayed:     z.number().optional(),
    gamesPlayed:          z.number().optional(),
    achievementsUnlocked: z.number().optional(),
    reviewsWritten:       z.number().optional(),
    totalGames:           z.number().optional(),
    wishlistCount:        z.number().optional(),
})

export const AccountGameSchema = z.object({
    appid:           z.number(),
    name:            z.string(),
    playtimeMin:     z.number().optional(),
    playtime2weeks:  z.number().nullable().optional(),
    lastPlayedAt:    z.string().optional(),
})

export const AccountGameSessionSchema = z.object({
    startedAt:   z.string(),
    endedAt:     z.string().nullable(),
    durationMin: z.number().optional(),
})

export const AccountGameRecordSchema = z.object({
    name:     z.string(),
    sessions: z.array(AccountGameSessionSchema).optional(),
})

export const AccountDataSchema = z.object({
    profile:        AccountProfileSchema,
    steam:          AccountSteamSchema.optional(),
    stats:          AccountStatsSchema.optional(),
    recentlyPlayed: z.array(AccountGameSchema).optional(),
    mostPlayed:     z.array(AccountGameSchema).optional(),
    sessions:       z.record(z.string(), AccountGameRecordSchema).optional(),
})

export type AccountProfile      = z.infer<typeof AccountProfileSchema>
export type AccountSteam        = z.infer<typeof AccountSteamSchema>
export type AccountStats        = z.infer<typeof AccountStatsSchema>
export type AccountGame         = z.infer<typeof AccountGameSchema>
export type AccountGameSession  = z.infer<typeof AccountGameSessionSchema>
export type AccountGameRecord   = z.infer<typeof AccountGameRecordSchema>
export type AccountData         = z.infer<typeof AccountDataSchema>
