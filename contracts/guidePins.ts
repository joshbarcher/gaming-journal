// Contract for GET/PUT /relay/api/guides/{appid}/{source}/{guideId}/pins — server-persisted guide
// TOC pins, the single source of truth shared by the web app and the native app so both see the
// same pins. Mirrors the {parsedAt, pins} envelope the clients previously kept per-device in
// localStorage (web) / AsyncStorage (native).
import { z } from 'zod'

export const GuidePinSchema = z.object({
    id:        z.string(),
    slug:      z.string(),          // base page slug, no #anchor
    pageLabel: z.string(),
    blockPath: z.array(z.number()), // index path into the rendered block tree
    label:     z.string(),          // text snippet from the pinned block, ≤70 chars
})

export const GuidePinsSchema = z.object({
    parsedAt: z.string().nullable(), // guide parse time these pins were saved against
    pins:     z.array(GuidePinSchema),
})

export type GuidePin  = z.infer<typeof GuidePinSchema>
export type GuidePins = z.infer<typeof GuidePinsSchema>
