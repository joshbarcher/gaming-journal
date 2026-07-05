// Contract for /api/franchises (SvelteKit's own file-backed route, not relay-proxied). Every
// mutation (POST/PUT create/update/reorder/addEntry/removeEntry) returns the full Franchise object
// per src/routes/api/franchises/**/+server.ts — confirmed by reading the route handlers directly,
// not assumed — except DELETE (franchise removal), which returns a bare 204.
import { z } from 'zod'

export const FranchiseEntrySchema = z.object({
    appid: z.number(),
    name:  z.string(),
})

export const FranchiseSchema = z.object({
    id:        z.string(),
    name:      z.string(),
    entries:   z.array(FranchiseEntrySchema),
    createdAt: z.string(),
    updatedAt: z.string(),
})

export const FranchiseListSchema = z.array(FranchiseSchema)

export type FranchiseEntry = z.infer<typeof FranchiseEntrySchema>
export type Franchise      = z.infer<typeof FranchiseSchema>
