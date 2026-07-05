// Contract for GET /relay/api/pcgw/{appid}. Values throughout `video`/`input`/`cloud` are string
// enums confirmed live: "true" | "false" | "hackable" | null, and occasionally free text
// (e.g. "always on", "limited") that PCGW.svelte's badge() maps to no badge at all — modeled as
// z.string().nullable().optional() rather than a strict enum to tolerate that free text.
import { z } from 'zod'

const enumStr = z.string().nullable().optional()

export const PcgwVideoSchema = z.object({
    widescreen: enumStr, ultrawide: enumStr, uhd4k: enumStr, hdr: enumStr,
    fps60: enumStr, fps120: enumStr, vsync: enumStr, aa: enumStr, af: enumStr,
    fov: enumStr, rayTracing: enumStr, frameGen: enumStr, upscaling: enumStr, colorBlind: enumStr,
}).partial()

export const PcgwInputSchema = z.object({
    mouse:    z.record(z.string(), enumStr).optional(),
    keyboard: z.record(z.string(), enumStr).optional(),
    controller: z.record(z.string(), enumStr).optional(),
    platform:   z.record(z.string(), enumStr).optional(),
}).partial()

export const PcgwSchema = z.object({
    appid:    z.number().optional(),
    steamName: z.string().optional(),
    pageTitle: z.string().optional(),
    pageUrl:   z.string().optional(),
    found:     z.boolean().optional(),
    video:     PcgwVideoSchema.optional(),
    input:     PcgwInputSchema.optional(),
    cloud:     z.record(z.string(), enumStr).optional(),
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
        html:  z.string(),
    })).optional(),
})

export type Pcgw = z.infer<typeof PcgwSchema>
