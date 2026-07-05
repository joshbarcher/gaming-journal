// Contract for GET /relay/api/steam/now-playing. Ported from the NowPlaying/NowPlayingSession
// types in gaming-journal's src/lib/types.ts. Confirmed the idle shape ({"playing":null}) against
// the local relay; no game was active during development so the populated-session shape is
// unverified live — fields kept optional/permissive until confirmed against a real session.
import { z } from 'zod'

export const SessionAchievementSchema = z.object({
    apiname:     z.string(),
    unlocktime:  z.number().optional(),
})

export const NowPlayingSessionSchema = z.object({
    appid:               z.number(),
    name:                z.string().optional(),
    sessionStartedAt:    z.string().optional(),
    achievementsDuring:  z.array(SessionAchievementSchema).optional(),
    // Per journal/sessions.md: playtime including the current session. Still unverified against a
    // real populated payload (no active session was observable during development) — kept
    // optional so a missing field doesn't break parsing; consumers fall back to the
    // basePlaytimeMin + sessionElapsedMin client-side calculation when absent.
    effectiveMin:        z.number().optional(),
})

export const NowPlayingSchema = z.object({
    playing: NowPlayingSessionSchema.nullable().optional(),
})

export type NowPlayingSession = z.infer<typeof NowPlayingSessionSchema>
export type NowPlaying        = z.infer<typeof NowPlayingSchema>
