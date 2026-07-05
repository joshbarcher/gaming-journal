// Contract for GET/PUT /api/order/{list} (backlog, in-progress, etc.) — plain array of appids.
// Verified against a real payload.
import { z } from 'zod'

export const OrderSchema = z.array(z.number())
export type Order = z.infer<typeof OrderSchema>
