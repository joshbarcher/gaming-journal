// Contract for GET /relay/api/pcgw/{appid}. Values throughout `video`/`input`/`cloud` are string
// enums confirmed live: "true" | "false" | "hackable" | null, and occasionally free text
// (e.g. "always on", "limited") that PCGW.svelte's badge() renders as a neutral badge — modeled as
// z.string().nullable().optional() rather than a strict enum to tolerate that free text.
//
// `notes` on each table carries the row's third cell as trusted PCGW HTML (relative links
// absolutized server-side). It is keyed by the same field names as the ratings beside it.
import { z } from 'zod'

const enumStr = z.string().nullable().optional()

const NotesSchema = z.record(z.string(), z.string()).optional()

export const PcgwVideoSchema = z.object({
    widescreen: enumStr, ultrawide: enumStr, uhd4k: enumStr, hdr: enumStr,
    fps60: enumStr, fps120: enumStr, vsync: enumStr, aa: enumStr, af: enumStr,
    fov: enumStr, rayTracing: enumStr, frameGen: enumStr, upscaling: enumStr, colorBlind: enumStr,
    notes: NotesSchema,
}).partial()

export const PcgwInputSchema = z.object({
    mouse:    z.record(z.string(), enumStr).optional(),
    keyboard: z.record(z.string(), enumStr).optional(),
    controller: z.record(z.string(), enumStr).optional(),
    platform:   z.record(z.string(), enumStr).optional(),
    // Mirrors the group/key nesting above: notes.controller.support, etc.
    notes:      z.record(z.string(), z.record(z.string(), z.string())).optional(),
}).partial()

// Cloud rows are per-provider ratings, plus the shared `notes` map.
export const PcgwCloudSchema = z.object({ notes: NotesSchema }).catchall(enumStr)

export const PcgwSchema = z.object({
    appid:    z.number().optional(),
    steamName: z.string().optional(),
    pageTitle: z.string().optional(),
    pageUrl:   z.string().optional(),
    found:     z.boolean().optional(),
    video:     PcgwVideoSchema.optional(),
    input:     PcgwInputSchema.optional(),
    cloud:     PcgwCloudSchema.optional(),
    availability: z.object({
        drm:      z.array(z.string()).optional(),
        steamDrm: z.string().nullable().optional(),
        gogDrm:   z.string().nullable().optional(),
    }).optional(),
    paths: z.object({
        config:   z.record(z.string(), z.string()).optional(),
        saveGame: z.record(z.string(), z.string()).optional(),
        gameData: z.record(z.string(), z.string()).optional(),
    }).optional(),
    fixes: z.array(z.object({
        title: z.string(),
        // Enclosing <h2>, e.g. "Essential improvements" / "Issues unresolved".
        // Null when the fix's own heading is the h2.
        group: z.string().nullable().optional(),
        html:  z.string(),
    })).optional(),
})

export type Pcgw = z.infer<typeof PcgwSchema>
