// Contract for GET /relay/api/itad/{appid} — the full deals list (distinct from
// contracts/gameDetail.ts's GameItadSummarySchema, which only models the lightweight bestPrice/
// historicalLow summary embedded in Phase 1's game payload). Confirmed live against ELDEN RING
// (6 real deals across stores).
import { z } from 'zod'

export const ItadDealSchema = z.object({
    store:      z.string(),
    storeId:    z.number().optional(),
    price:      z.number(),
    regular:    z.number(),
    cut:        z.number(),
    url:        z.string().optional(),
    resolvedAt: z.string().optional(),
})

export const ItadDataSchema = z.object({
    appid:      z.number().optional(),
    steamName:  z.string().optional(),
    itadId:     z.string().optional(),
    fetchedAt:  z.string().optional(),
    deals:      z.array(ItadDealSchema).optional(),
    historicalLow: z.object({
        price: z.number(), cut: z.number(), store: z.string(), date: z.string().optional(),
    }).nullable().optional(),
})

export type ItadDeal = z.infer<typeof ItadDealSchema>
export type ItadData = z.infer<typeof ItadDataSchema>
