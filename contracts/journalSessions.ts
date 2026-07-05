// Contract for the `sessions` slice of GET /relay/api/account — scoped tightly to what the Journal
// dashboard's LastSessionCard/SessionHistoryRail need (this endpoint's full payload also carries
// profile/steam/stats/recentlyPlayed/mostPlayed, none of which the dashboard uses). Confirmed live:
// keyed by string appid, each with a `name` + `sessions[]` array (startedAt/endedAt ISO strings,
// durationMin, achievements with apiname+unlocktime).
import { z } from 'zod'

export const SessionAchievementSchema = z.object({
    apiname:    z.string(),
    unlocktime: z.number().optional(),
})

export const JournalSessionSchema = z.object({
    startedAt:    z.string(),
    endedAt:      z.string().optional(),
    durationMin:  z.number().optional(),
    achievements: z.array(SessionAchievementSchema).optional(),
})

export const AccountSessionsResponseSchema = z.object({
    sessions: z.record(z.string(), z.object({
        name:     z.string().optional(),
        sessions: z.array(JournalSessionSchema).optional(),
    })).optional(),
})

export type SessionAchievement       = z.infer<typeof SessionAchievementSchema>
export type JournalSession           = z.infer<typeof JournalSessionSchema>
export type AccountSessionsResponse  = z.infer<typeof AccountSessionsResponseSchema>
