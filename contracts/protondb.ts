// Contract for GET /relay/api/protondb/{appid}. GamePage.svelte nulls this out client-side when
// `raw?.notFound || !raw?.tier` — modeled here as the raw possible shapes; the RN API module
// applies the same null-coalescing rule (see src/api/gamePage.ts).
import { z } from 'zod'

export const ProtonDbRawSchema = z.object({
    appid:            z.number().optional(),
    tier:             z.string().nullable().optional(),
    bestReportedTier: z.string().optional(),
    trendingTier:     z.string().optional(),
    confidence:       z.string().optional(),
    score:            z.number().optional(),
    total:            z.number().optional(),
    fetchedAt:        z.string().optional(),
    notFound:         z.boolean().optional(),
})

export type ProtonDbRaw = z.infer<typeof ProtonDbRawSchema>
