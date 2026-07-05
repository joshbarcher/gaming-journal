// Contract for GET /relay/api/hltb — a plain array (not a map), verified against a real payload.
import { z } from 'zod'

export const HltbEntrySchema = z.object({
    appid:                 z.number(),
    gameplayMain:          z.number().nullable().optional(),
    gameplayMainExtra:     z.number().nullable().optional(),
    gameplayCompletionist: z.number().nullable().optional(),
})

export const HltbIndexSchema = z.array(HltbEntrySchema)

export type HltbEntry = z.infer<typeof HltbEntrySchema>
