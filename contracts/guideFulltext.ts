// Contract for GET /relay/api/guides/{appid}/{source}/{guideId}/fulltext — one entry per content
// block (not per page), used to build a client-side Fuse.js search index. Confirmed live: a real
// guide produced 4878 entries.
import { z } from 'zod'

export const FtEntrySchema = z.object({
    slug: z.string(),
    label: z.string(),
    text: z.string(),
    blockPath: z.array(z.number()).optional(),
})

export const GuideFulltextResponseSchema = z.array(FtEntrySchema)

export type FtEntry = z.infer<typeof FtEntrySchema>
