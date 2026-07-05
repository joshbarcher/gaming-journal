// Contract for GET /relay/api/videos/{appid} — a flat array of trailers, not wrapped in an object.
import { z } from 'zod'

export const VideoEntrySchema = z.object({
    index:     z.number(),
    name:      z.string().optional(),
    thumbnail: z.string().optional(),
})

export const VideosResponseSchema = z.array(VideoEntrySchema)

export type VideoEntry = z.infer<typeof VideoEntrySchema>
