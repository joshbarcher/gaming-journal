// Contract for GET /relay/api/steam/achievements/{appid}. Confirmed live against ELDEN RING
// (42 real achievements, both localIcon/localIconGray relay-relative paths and raw Steam CDN
// fallback icon/icongray present).
import { z } from 'zod'

export const AchievementItemSchema = z.object({
    apiname:      z.string(),
    displayName:  z.string().optional(),
    // Confirmed live across the full 42-achievement set (not just a sample): many are `null`, not
    // just absent — likely hidden/secret achievements with no description until unlocked.
    description:  z.string().nullable().optional(),
    hidden:       z.number().optional(),
    achieved:     z.number(),
    unlocktime:   z.number().optional(),
    icon:         z.string().optional(),
    icongray:     z.string().optional(),
    localIcon:    z.string().optional(),
    localIconGray: z.string().optional(),
})

export const AchievementsResponseSchema = z.object({
    fetchedAt:      z.string().optional(),
    gameName:       z.string().optional(),
    achievements:   z.array(AchievementItemSchema).optional(),
    hasPlayerData:  z.boolean().optional(),
})

export type AchievementItem       = z.infer<typeof AchievementItemSchema>
export type AchievementsResponse  = z.infer<typeof AchievementsResponseSchema>
