// Contract for GET /relay/api/games/posters?source=&n=. Verified against a real payload — plain
// array (not wrapped in an envelope), poster/header are relay-relative paths (need the API host
// prepended, same convention as contracts/home.ts's resume.header — unlike discoverSearch.ts's
// absolute steamstatic URLs).
import { z } from 'zod'

export const PosterItemSchema = z.object({
    appid:  z.number(),
    poster: z.string(),
    header: z.string().optional(),
})

export const PostersResponseSchema = z.array(PosterItemSchema)

export type PosterItem = z.infer<typeof PosterItemSchema>
