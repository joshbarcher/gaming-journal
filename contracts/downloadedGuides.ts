// Contract for GET /relay/api/guides/{appid} — the downloaded-guides list shown on the Journal
// dashboard's Guides card. Confirmed live against Persona 3 Reload (4 real guides across
// game8/gamefaqs/ign/neoseeker sources). The full guide viewer/downloader flow is Phase 3 — this
// only covers what the dashboard card itself displays.
import { z } from 'zod'

export const DownloadedGuideSchema = z.object({
    source:      z.string(),
    guideId:     z.string(),
    title:       z.string(),
    author:      z.string().nullable().optional(),
    parsedAt:    z.string().nullable().optional(),
    pageCount:   z.number().optional(),
    sizeBytes:   z.number().optional(),
    lastUsedAt:  z.string().nullable().optional(),
})

export const DownloadedGuidesResponseSchema = z.array(DownloadedGuideSchema)

export type DownloadedGuide = z.infer<typeof DownloadedGuideSchema>
