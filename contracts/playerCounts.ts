// Contract for GET /relay/api/player-counts/{appid}. Confirmed live against ELDEN RING —
// samples is a flat [unixSeconds, count][] tuple array, not an object.
import { z } from 'zod'

export const PlayerCountsSchema = z.object({
    name:         z.string().optional(),
    peakAllTime:  z.number().optional(),
    samples:      z.array(z.tuple([z.number(), z.number()])).optional(),
})

export type PlayerCounts = z.infer<typeof PlayerCountsSchema>
