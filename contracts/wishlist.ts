// Contract for GET /relay/api/wishlist. The feature doc (collections/wishlist.md) claims this data
// comes from GET /api/local-wishlist returning SteamGame[] — checked the real payload and the
// actual Svelte source (WishlistPage.svelte:166) and found both wrong: /api/local-wishlist returns
// a much thinner {items: Record<appid, {dateAdded}>} shape; the component actually fetches the
// richer /relay/api/wishlist instead. Schema below is scoped to what's really used, verified
// against a real payload. Also note: the payload's own media.header field
// ("/images/steam/games/{appid}/header.jpg") is NOT what the web component renders — it hardcodes
// "/relay/images/steam/games/{appid}/header.jpg" instead (WishlistPage.svelte:248), same convention
// used elsewhere in this app — so the RN side constructs the URL the same way, ignoring media.header.
//
// Caught by npm run verify-contracts against the FULL live dataset (1100+ items — not just the
// first page a manual curl sample happened to show): itad.bestPrice, itad.historicalLow,
// store.releaseDateIso, AND wishlist.priority can all be `null`, not just absent — plain
// .optional() (undefined-only) wasn't enough, needed .nullable() too. This looks like a systematic
// relay convention (null for "not yet computed", not just an omitted key), so every genuinely
// optional field below is nullable, not just the ones a small manual sample happened to surface.
// A small sample can miss real shape variance; running the schema against everything is what
// actually catches it.
import { z } from 'zod'

export const WishlistGameSchema = z.object({
    appid: z.number(),
    name:  z.string(),
    wishlist: z.object({
        priority:  z.number().nullable().optional(),
        dateAdded: z.number().nullable().optional(),
        local:     z.boolean().nullable().optional(),
    }).optional(),
    store: z.object({
        unavailable:    z.boolean().nullable().optional(),
        isFree:         z.boolean().nullable().optional(),
        comingSoon:     z.boolean().nullable().optional(),
        releaseDateIso: z.string().nullable().optional(),
        price: z.object({
            amount:    z.number().nullable().optional(),
            formatted: z.string().nullable().optional(),
        }).nullable().optional(),
    }).optional(),
    itad: z.object({
        bestPrice: z.object({
            price: z.number(),
            cut:   z.number(),
            store: z.string(),
            url:   z.string().nullable().optional(),
        }).nullable().optional(),
        historicalLow: z.object({
            price: z.number(),
            cut:   z.number(),
            store: z.string(),
            date:  z.string().nullable().optional(),
        }).nullable().optional(),
    }).optional(),
    flags: z.object({
        alert: z.boolean().nullable().optional(),
    }).optional(),
})

export const WishlistResponseSchema = z.array(WishlistGameSchema)

export type WishlistGame = z.infer<typeof WishlistGameSchema>
