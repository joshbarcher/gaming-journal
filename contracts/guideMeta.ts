// Contract for GET /relay/api/guides/{appid}/{source}/{guideId}/meta. Confirmed live against a
// real downloaded guide (Persona 3 Reload's IGN guide, including a real 12-entry `coverImages[]`).
import { z } from 'zod'

export const NavItemSchema: z.ZodType<unknown> = z.lazy(() => z.union([
    z.object({ type: z.literal('link'), slug: z.string(), label: z.string() }),
    z.object({ type: z.literal('group'), slug: z.string().optional(), label: z.string(), children: z.array(NavItemSchema) }),
    z.object({ type: z.literal('label'), label: z.string() }),
]))

export const GuidePageRefSchema = z.object({
    slug: z.string(),
    label: z.string(),
})

export const CoverImageSchema = z.object({
    section: z.string(),
    src: z.string(),
})

export const GuideMetaSchema = z.object({
    steamId: z.union([z.string(), z.number()]).optional(),
    source: z.string().optional(),
    guideId: z.string().optional(),
    title: z.string(),
    author: z.string().nullable().optional(),
    sourceUrl: z.string().nullable().optional(),
    parsedAt: z.string().nullable().optional(),
    nav: z.unknown().optional(),
    navTree: z.array(NavItemSchema).optional(),
    pages: z.array(GuidePageRefSchema).optional(),
    version: z.union([z.string(), z.number()]).optional(),
    sizeBytes: z.number().optional(),
    coverImages: z.array(CoverImageSchema).optional(),
})

export type GuidePageRef = z.infer<typeof GuidePageRefSchema>
export type CoverImage   = z.infer<typeof CoverImageSchema>
export type GuideMeta    = z.infer<typeof GuideMetaSchema>

// NavItemSchema is `z.ZodType<unknown>` (a recursive z.lazy() union), so `z.infer` alone loses the
// real shape — declared explicitly here so every consumer (the Guide viewer section screen, the
// TOC sidebar drawer) shares one real type instead of each redeclaring its own local copy.
export type NavItem =
    | { type: 'link'; slug: string; label: string }
    | { type: 'group'; slug?: string; label: string; children: NavItem[] }
    | { type: 'label'; label: string }
