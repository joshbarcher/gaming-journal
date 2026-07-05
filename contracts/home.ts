// Contract for GET /relay/api/home. Verified against a real payload from the local relay
// (resume + libPosters + wlPosters all confirmed live). "release" was null during development —
// its shape below is ported directly from +page.server.ts's HomeRelease interface (the SvelteKit
// gateway's own source, not guessed), but still unverified against a real populated payload since
// no wishlisted game released today locally.
import { z } from 'zod'

export const HomeResumeSchema = z.object({
    appid:   z.number(),
    name:    z.string(),
    header:  z.string(),
    hours:   z.number(),
    daysAgo: z.number(),
})

export const HomeReleaseSchema = z.object({
    appid:  z.number(),
    name:   z.string(),
    header: z.string(),
})

export const HomePosterSchema = z.object({
    appid:  z.number(),
    header: z.string(),
})

export const HomeDataSchema = z.object({
    resume:     HomeResumeSchema.nullable(),
    release:    HomeReleaseSchema.nullable(),
    libPosters: z.array(HomePosterSchema),
    wlPosters:  z.array(HomePosterSchema),
})

export type HomeResume  = z.infer<typeof HomeResumeSchema>
export type HomeRelease = z.infer<typeof HomeReleaseSchema>
export type HomePoster  = z.infer<typeof HomePosterSchema>
export type HomeData    = z.infer<typeof HomeDataSchema>
