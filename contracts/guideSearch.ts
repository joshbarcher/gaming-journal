// Contract for the Guide search/discovery flow (guides/search.md):
//   GET  /relay/api/guides/{appid}/search        — cached _search.json (or `null` if never searched;
//                                                    handleSearch() catches its own readFile failure
//                                                    and responds `res.json(null)`, not a 404)
//   POST /relay/api/guides/{appid}/search        — SSE, body {gameName, source}, streams SearchSseEvent
// Confirmed against Persona 3 Reload's real, populated _search.json (7 sources, real GameFAQs/IGN/
// Steam/Game8 guide lists) rather than a synthetic fixture.
import { z } from 'zod'

export const MatchedGameSchema = z.object({
    name:     z.string(),
    platform: z.string().optional(),
    gameUrl:  z.string(),
    score:    z.number(),
})

export const GuideResultSchema = z.object({
    title:    z.string(),
    url:      z.string(),
    type:     z.enum(['html', 'text', 'unknown']),
    // Steam guides carry their category inline too (in addition to the top-level `categories` map) —
    // confirmed live, not in the doc's storage sample.
    category: z.string().optional(),
})

export const SourceSearchDataSchema = z.object({
    searchedAt:  z.string(),
    matchedGame: MatchedGameSchema.nullable(),
    guides:      z.array(GuideResultSchema),
    // Steam-only — confirmed live keyed by tag name (e.g. "Walkthroughs").
    categories:  z.record(z.string(), z.array(GuideResultSchema)).optional(),
})

export const GuideSearchDataSchema = z.object({
    steamId: z.string(),
    sources: z.record(z.string(), SourceSearchDataSchema),
})

// GET response is nullable — a game with no search run yet gets a real `null` body (200), not a 404.
export const GuideSearchGetResponseSchema = GuideSearchDataSchema.nullable()

// SSE event shapes ported verbatim from guides.controller.js's own JSDoc comment on handleSearchRun.
export const SearchSseEventSchema = z.discriminatedUnion('phase', [
    z.object({ phase: z.literal('status'), message: z.string() }),
    z.object({ phase: z.literal('done'), data: GuideSearchDataSchema }),
    z.object({ phase: z.literal('not_found'), message: z.string() }),
    z.object({ phase: z.literal('error'), message: z.string() }),
])

export type MatchedGame     = z.infer<typeof MatchedGameSchema>
export type GuideResult     = z.infer<typeof GuideResultSchema>
export type SourceSearchData = z.infer<typeof SourceSearchDataSchema>
export type GuideSearchData = z.infer<typeof GuideSearchDataSchema>
export type SearchSseEvent  = z.infer<typeof SearchSseEventSchema>

export const GUIDE_SOURCES = ['gamefaqs', 'ign', 'steam', 'game8', 'gamerguides', 'fandom', 'neoseeker'] as const
export type GuideSource = typeof GUIDE_SOURCES[number]
