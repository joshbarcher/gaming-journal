// Contract for GET /relay/api/games/{appid} — the richest single endpoint in the app. Scoped to
// fields actually used by the Game detail screen's base sections (Hero, FlagsBar, HLTB,
// Screenshots, Trailers, About) — the embedded hltb/itad/pcgw here are lightweight SUMMARY shapes,
// distinct from the full background-loaded shapes (see contracts/pcgw.ts, contracts/itad.ts).
// Confirmed live against ELDEN RING (appid 1245620) via curl, not assumed from the doc.
import { z } from 'zod'

export const GameStoreSchema = z.object({
    type:        z.string().optional(),
    isFree:      z.boolean().optional(),
    unavailable: z.boolean().optional(),
    description: z.string().nullable().optional(),
    developers:  z.array(z.string()).nullable().optional(),
    publishers:  z.array(z.string()).nullable().optional(),
    price: z.object({
        currency:          z.string().optional(),
        initial:           z.number().optional(),
        final:             z.number().optional(),
        discount_percent:  z.number().optional(),
        initial_formatted: z.string().optional(),
        final_formatted:   z.string().optional(),
    }).nullable().optional(),
    platforms: z.object({
        windows: z.boolean().optional(),
        mac:     z.boolean().optional(),
        linux:   z.boolean().optional(),
    }).nullable().optional(),
    // Confirmed real (not guessed): GameHero.svelte handles this as EITHER a bare number OR an
    // object with a `.score` field — `typeof mcData === 'number' ? mcData : mcData?.score`.
    metacritic: z.union([z.number(), z.object({ score: z.number().optional(), url: z.string().optional() })]).nullable().optional(),
    categories: z.array(z.string()).nullable().optional(),
    genres:     z.array(z.string()).nullable().optional(),
    tags:       z.array(z.string()).nullable().optional(),
    releaseDate:         z.string().nullable().optional(),
    recommendations:     z.number().nullable().optional(),
    requiredAge:         z.union([z.string(), z.number()]).nullable().optional(),
    detailedDescription: z.string().nullable().optional(),
})

export const GameMediaSchema = z.object({
    header:      z.string().nullable().optional(),
    capsule:     z.string().nullable().optional(),
    poster:      z.string().nullable().optional(),
    hero:        z.string().nullable().optional(),
    background:  z.string().nullable().optional(),
    logo:        z.string().nullable().optional(),
    screenshots: z.array(z.string()).nullable().optional(),
})

// Summary HLTB shape embedded in the game payload (Phase 1) — distinct from any richer shape a
// dedicated /relay/api/hltb/{appid} background refresh might return.
export const GameHltbSummarySchema = z.object({
    matched:               z.boolean(),
    matchedName:           z.string().nullable().optional(),
    confidence:            z.number().nullable().optional(),
    hltbId:                z.number().nullable().optional(),
    gameplayMain:          z.number().nullable().optional(),
    gameplayMainExtra:     z.number().nullable().optional(),
    gameplayCompletionist: z.number().nullable().optional(),
    imageUrl:              z.string().nullable().optional(),
})

export const GameItadSummarySchema = z.object({
    bestPrice: z.object({
        price: z.number().optional(), cut: z.number().optional(), store: z.string().optional(),
    }).nullable().optional(),
    historicalLow: z.object({
        price: z.number().optional(), cut: z.number().optional(), store: z.string().optional(), date: z.string().optional(),
    }).nullable().optional(),
})

export const GameDetailSchema = z.object({
    appid:           z.number(),
    name:            z.string(),
    source:          z.enum(['library', 'wishlist', 'both', 'discovered']),
    playtimeMinutes: z.number().nullable().optional(),
    wishlist:        z.unknown().nullable().optional(),
    store:           GameStoreSchema.nullable().optional(),
    media:           GameMediaSchema.nullable().optional(),
    hltb:            GameHltbSummarySchema.nullable().optional(),
    itad:            GameItadSummarySchema.nullable().optional(),
    // pcgw's embedded summary is a flat map of string-enum booleans — not modeled field-by-field
    // here since the Game detail screen's base sections don't read it directly (the full PCGW
    // section reads from the dedicated /relay/api/pcgw/{appid} endpoint instead, see contracts/pcgw.ts).
    pcgw: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type GameDetail = z.infer<typeof GameDetailSchema>
export type GameStore  = z.infer<typeof GameStoreSchema>
