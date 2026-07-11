// Contract for GET /relay/api/nexus/{appid} — a game's top mods from NexusMods,
// with images mirrored to the relay (localThumb/localImage) and Nexus CDN URLs
// (thumbUrl/imageUrl) as fallbacks. An unmatched game returns the same shape with
// domainName: null and mods: []. Confirmed live against Skyrim SE (12 mods).
import { z } from 'zod'

export const NexusModSchema = z.object({
    modId:          z.number(),
    name:           z.string(),
    summary:        z.string().nullable().optional(),
    version:        z.string().nullable().optional(),
    author:         z.string().nullable().optional(),
    uploaderName:   z.string().nullable().optional(),
    uploaderAvatar: z.string().nullable().optional(),
    imageUrl:       z.string().nullable().optional(),
    thumbUrl:       z.string().nullable().optional(),
    localImage:     z.string().nullable().optional(),
    localThumb:     z.string().nullable().optional(),
    downloads:      z.number(),
    endorsements:   z.number(),
    adult:          z.boolean(),
    category:       z.string().nullable().optional(),
    createdAt:      z.string().nullable().optional(),
    updatedAt:      z.string().nullable().optional(),
    url:            z.string(),
})

export const NexusDataSchema = z.object({
    appid:      z.number(),
    steamName:  z.string().nullable().optional(),
    domainName: z.string().nullable().optional(),
    gameId:     z.number().nullable().optional(),
    nexusName:  z.string().nullable().optional(),
    gameUrl:    z.string().nullable().optional(),
    totalMods:  z.number().optional(),
    fetchedAt:  z.string().optional(),
    mods:       z.array(NexusModSchema),
})

export type NexusMod  = z.infer<typeof NexusModSchema>
export type NexusData = z.infer<typeof NexusDataSchema>
