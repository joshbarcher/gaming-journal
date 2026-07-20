// Contract for GET /api/settings — this app's own SvelteKit route (not relay-proxied). Ported
// from the `Settings` interface in gaming-journal's src/lib/types.ts, verified against a real
// payload from the local server (all 5 fields present, non-optional).
import { z } from 'zod'

export const SettingsSchema = z.object({
    showChildLocked:        z.boolean(),
    showFiltered:           z.boolean(),
    showSoftware:           z.boolean(),
    hideUnavailable:        z.boolean(),
    titleBlocklist:         z.array(z.string()),
    discoverFiltersEnabled: z.boolean(),
    hideAdultContent:       z.boolean(),
    guidePinsCollapsed:     z.boolean(),
})

export type Settings = z.infer<typeof SettingsSchema>
