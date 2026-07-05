// Contract for GET /api/alerts — this app's own SvelteKit route (not relay-proxied), backed by
// alertsService.ts's getAlerts(). Ported from the AlertResult/BestPrice interfaces in
// gaming-journal's src/lib/types.ts. Home's sale card only ever reads `onSale`, but both arrays
// are typed since the same endpoint always returns both.
import { z } from 'zod'

export const BestPriceSchema = z.object({
    price: z.number(),
    cut:   z.number(),
    store: z.string(),
    url:   z.string().nullable(),
})

export const AlertResultSchema = z.object({
    appid:         z.number(),
    name:          z.string(),
    bestPrice:     BestPriceSchema.nullable(),
    historicalLow: z.unknown().nullable().optional(),
    isLibrary:     z.boolean(),
})

export const AlertsResponseSchema = z.object({
    onSale:   z.array(AlertResultSchema),
    watching: z.array(AlertResultSchema),
})

export type BestPrice   = z.infer<typeof BestPriceSchema>
export type AlertResult = z.infer<typeof AlertResultSchema>
export type AlertsResponse = z.infer<typeof AlertsResponseSchema>
