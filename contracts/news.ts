// Contract for GET /relay/api/news/{appid}. `date` is unix SECONDS (confirmed live), not ms.
import { z } from 'zod'

export const NewsItemSchema = z.object({
    gid:            z.string().optional(),
    title:          z.string(),
    url:            z.string().optional(),
    is_external_url: z.boolean().optional(),
    author:         z.string().optional(),
    contents:       z.string().optional(),
    feedlabel:      z.string().optional(),
    feedname:       z.string().optional(),
    date:           z.number(),
})

export const NewsResponseSchema = z.object({
    fetchedAt: z.string().optional(),
    appid:     z.number().optional(),
    items:     z.array(NewsItemSchema).optional(),
})

export type NewsItem     = z.infer<typeof NewsItemSchema>
export type NewsResponse = z.infer<typeof NewsResponseSchema>
