// Contract for POST /relay/api/recommend (discovery/recommend.md). Confirmed live: a fresh call
// with empty filters returns a real `{done:false, sequence, question}`; a full filter set with all
// values `null` (skipping every question) returns a real `{done:true, sequence, games, relaxed}`.
import { z } from 'zod'

export const RecommendOptionSchema = z.object({
    value: z.string(),
    label: z.string(),
    count: z.number(),
})

export const RecommendQuestionSchema = z.object({
    type:    z.string(),
    label:   z.string(),
    options: z.array(RecommendOptionSchema),
})

// `header` is already a full relay-relative path (`/relay/images/steam/games/{appid}/header.jpg`),
// confirmed live — same apiHost-prefix convention as every other relay-relative image path in this
// app (contracts/home.ts, posters.ts, etc.).
export const RecommendGameSchema = z.object({
    appid:           z.number(),
    name:            z.string(),
    playtimeMinutes: z.number(),
    header:          z.string(),
})

export const RecommendResponseSchema = z.discriminatedUnion('done', [
    z.object({ done: z.literal(false), sequence: z.array(z.string()), question: RecommendQuestionSchema }),
    z.object({ done: z.literal(true), sequence: z.array(z.string()), games: z.array(RecommendGameSchema), relaxed: z.boolean().optional() }),
])

export const RECOMMEND_DEPTHS = ['shallow', 'normal', 'deep'] as const
export type RecommendDepth = typeof RECOMMEND_DEPTHS[number]

export type RecommendOption  = z.infer<typeof RecommendOptionSchema>
export type RecommendQuestion = z.infer<typeof RecommendQuestionSchema>
export type RecommendGame    = z.infer<typeof RecommendGameSchema>
export type RecommendResponse = z.infer<typeof RecommendResponseSchema>
