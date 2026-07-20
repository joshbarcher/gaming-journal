// NexusMods API — port of the web app's fetch() calls in NexusMods.svelte / ModsPage.svelte /
// ModDetailPage.svelte / Settings.svelte. Every relay endpoint used here was read directly from the
// real +server.ts routes under src/routes/relay/api/nexus/*:
//   GET  /relay/api/nexus/:appid                 — game's top-mods section entry (NexusData)
//                                                  (?fetch=true&name= kicks a background sync → 202)
//   POST /relay/api/nexus/sync/:appid?force=true — force-resync a game (section refresh)
//   GET  /relay/api/nexus/:appid/mods            — one sorted/searched/adult-filtered page
//   GET  /relay/api/nexus/:appid/deep            — deep-pull dataset + progress
//   POST /relay/api/nexus/:appid/deep            — start/refresh the deep pull
//   GET  /relay/api/nexus/:appid/mod/:modId      — rich single-mod detail
//   GET  /relay/api/nexus/session                — Nexus login-session status
//   GET  /relay/api/nexus/backfill               — adult-image backfill progress
//   POST /relay/api/nexus/backfill { action }    — start | pause | reset the backfill
import { z } from 'zod'

import { apiGet, apiGetOrNull, apiPost } from './client'
import { getApiHost } from './config'
import { NexusDataSchema, NexusModSchema } from 'gaming-journal-contracts/nexusMods'

// The shared contract's NexusModSchema omits fields the list/deep/detail views rely on
// (fileSize, tags, imageLargeUrl). Extend it here rather than editing the shared contract file.
export const NexusModFullSchema = NexusModSchema.extend({
    fileSize:      z.number().nullable().optional(),
    imageLargeUrl: z.string().nullable().optional(),
    tags:          z.array(z.string()).optional(),
})
export type NexusModFull = z.infer<typeof NexusModFullSchema>
export type NexusData = z.infer<typeof NexusDataSchema>

// GET /relay/api/nexus/:appid/mods — one page of the full mods list.
export const NexusModsPageSchema = z.object({
    appid:      z.number(),
    domainName: z.string().nullable().optional(),
    nexusName:  z.string().nullable().optional(),
    gameUrl:    z.string().nullable().optional(),
    sort:       z.string(),
    q:          z.string(),
    offset:     z.number(),
    limit:      z.number(),
    totalCount: z.number(),
    mods:       z.array(NexusModFullSchema),
})
export type NexusModsPage = z.infer<typeof NexusModsPageSchema>

// GET/POST /relay/api/nexus/:appid/deep — full-catalogue crawl dataset + progress.
export const NexusDeepSchema = z.object({
    appid:      z.number(),
    domainName: z.string().nullable().optional(),
    nexusName:  z.string().nullable().optional(),
    gameUrl:    z.string().nullable().optional(),
    status:     z.enum(['idle', 'running', 'done', 'error']),
    pulled:     z.number(),
    total:      z.number(),
    capped:     z.boolean(),
    cap:        z.number().optional(),
    mods:       z.array(NexusModFullSchema),
    updatedAt:  z.string().optional(),
})
export type NexusDeep = z.infer<typeof NexusDeepSchema>

// GET /relay/api/nexus/:appid/mod/:modId — rich single-mod detail. descriptionBlocks come from the
// relay's shared guide content-parser (same block shapes as guide ContentBlock[]) — kept loose here
// and cast to that renderer's type at the call site.
export const NexusGalleryShotSchema = z.object({
    url:      z.string(),
    localUrl: z.string().nullable().optional(),
})
export const NexusModDetailSchema = z.object({
    appid:                 z.number(),
    modId:                 z.number(),
    gameId:                z.number().nullable().optional(),
    name:                  z.string(),
    summary:               z.string().nullable().optional(),
    description:           z.string().nullable().optional(),
    version:               z.string().nullable().optional(),
    author:                z.string().nullable().optional(),
    fileSize:              z.number().nullable().optional(),
    downloads:             z.number(),
    endorsements:          z.number(),
    adult:                 z.boolean(),
    status:                z.string().nullable().optional(),
    supportsVortex:        z.boolean().optional(),
    directDownloadEnabled: z.boolean().optional(),
    category:              z.string().nullable().optional(),
    uploaderName:          z.string().nullable().optional(),
    uploaderAvatar:        z.string().nullable().optional(),
    uploaderId:            z.number().nullable().optional(),
    tags:                  z.array(z.string()).default([]),
    imageUrl:              z.string().nullable().optional(),
    imageLargeUrl:         z.string().nullable().optional(),
    thumbUrl:              z.string().nullable().optional(),
    localImage:            z.string().nullable().optional(),
    createdAt:             z.string().nullable().optional(),
    updatedAt:             z.string().nullable().optional(),
    url:                   z.string(),
    fetchedAt:             z.string().optional(),
    descriptionBlocks:     z.array(z.any()).optional(),
    gallery:               z.array(NexusGalleryShotSchema).optional(),
    authorImagesAt:        z.string().optional(),
})
export type NexusModDetail = z.infer<typeof NexusModDetailSchema>
export type NexusGalleryShot = z.infer<typeof NexusGalleryShotSchema>

// GET /relay/api/nexus/session — never leaks cookie values.
export const NexusSessionSchema = z.object({
    present:    z.boolean(),
    status:     z.string(),
    capturedAt: z.string().nullable().optional(),
    expiredAt:  z.string().nullable().optional(),
})
export type NexusSession = z.infer<typeof NexusSessionSchema>

// GET/POST /relay/api/nexus/backfill — resumable adult-image backfill job. Only the fields the
// Settings UI reads are declared; z.object strips the rest (queue/games/cursor/etc.) harmlessly.
export const NexusBackfillSchema = z.object({
    status:       z.string(),
    total:        z.number().optional().default(0),
    done:         z.number().optional().default(0),
    added:        z.number().optional().default(0),
    currentGame:  z.string().nullable().optional(),
    pausedReason: z.string().nullable().optional(),
    perGameCap:   z.number().optional(),
    running:      z.boolean().optional(),
    blocked:      z.string().optional(),
})
export type NexusBackfill = z.infer<typeof NexusBackfillSchema>

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── Game-page "Mods" section ──────────────────────────────────────────────────────────────────
// GET /relay/api/nexus/:appid — a cache miss with ?fetch=true kicks a background sync and answers
// 202 {status:'pending'}; the web polls until it resolves (GamePage.svelte's worker fetch). We do
// the same, then return the cached NexusData (or null for "no mods / not on Nexus").
export async function getNexusData(appid: number, name?: string): Promise<NexusData | null> {
    const host = await getApiHost()
    const nameQ = name ? `&name=${encodeURIComponent(name)}` : ''
    const url = `${host}/relay/api/nexus/${appid}?fetch=true${nameQ}`
    for (let i = 0; i < 20; i++) {
        let res: Response
        try { res = await fetch(url) } catch { return null }
        if (res.status === 202) { await sleep(1500); continue }
        if (res.status === 404) return null
        if (!res.ok) return null
        const text = await res.text()
        const json = text ? JSON.parse(text) : null
        // Belt-and-braces: a 200 body can still carry the pending sentinel on some paths.
        if (json && json.status === 'pending') { await sleep(1500); continue }
        return NexusDataSchema.parse(json)
    }
    return null
}

// Section refresh — force-resync (POST) then re-read, mirroring GamePage.svelte's refreshNexus().
export async function refreshNexusData(appid: number, name?: string): Promise<NexusData | null> {
    const host = await getApiHost()
    const nameQ = name ? `&name=${encodeURIComponent(name)}` : ''
    try {
        await fetch(`${host}/relay/api/nexus/sync/${appid}?force=true${nameQ}`, { method: 'POST' })
    } catch { /* getNexusData below still reports whatever's cached */ }
    return getNexusData(appid, name)
}

// ── Full mods list page ─────────────────────────────────────────────────────────────────────────
export function getModsPage(
    appid: number,
    opts: { sort: string; offset: number; limit: number; q: string; adult: 'hide' | 'all' | 'only' },
): Promise<NexusModsPage> {
    const qs = new URLSearchParams({
        sort:   opts.sort,
        offset: String(opts.offset),
        limit:  String(opts.limit),
        q:      opts.q,
        adult:  opts.adult,
    })
    return apiGet(`/relay/api/nexus/${appid}/mods?${qs.toString()}`, NexusModsPageSchema)
}

// Deep pull — POST to start/refresh the crawl (fire-and-forget, progress read via getDeep), GET to
// poll the dataset + progress. Mirrors ModsPage.svelte's startDeep()/pollDeep().
export async function startDeepPull(appid: number, name?: string): Promise<void> {
    const host = await getApiHost()
    const nameQ = name ? `?name=${encodeURIComponent(name)}` : ''
    try { await fetch(`${host}/relay/api/nexus/${appid}/deep${nameQ}`, { method: 'POST' }) } catch { /* poll reports */ }
}
export function getDeep(appid: number): Promise<NexusDeep> {
    return apiGet(`/relay/api/nexus/${appid}/deep`, NexusDeepSchema)
}

// ── Mod detail ────────────────────────────────────────────────────────────────────────────────
export function getModDetail(appid: number, modId: number, name?: string): Promise<NexusModDetail | null> {
    const nameQ = name ? `?name=${encodeURIComponent(name)}` : ''
    return apiGetOrNull(`/relay/api/nexus/${appid}/mod/${modId}${nameQ}`, NexusModDetailSchema)
}

// ── Settings: session status + adult-image backfill ─────────────────────────────────────────────
export const getNexusSession = (): Promise<NexusSession> => apiGet('/relay/api/nexus/session', NexusSessionSchema)
export const getBackfillStatus = (): Promise<NexusBackfill> => apiGet('/relay/api/nexus/backfill', NexusBackfillSchema)
export const backfillAction = (action: 'start' | 'pause' | 'reset'): Promise<NexusBackfill> =>
    apiPost('/relay/api/nexus/backfill', NexusBackfillSchema, { action })

// ── Formatting helpers (ports of src/lib/js/nexusFormat.ts) ─────────────────────────────────────
// 494469 → "494K", 24669741 → "24.7M". One decimal below 10K / 100M; unit picked AFTER rounding.
function fmtUnit(value: number, oneDecimalBelow: number): string {
    return value < oneDecimalBelow
        ? value.toFixed(1).replace(/\.0$/, '')
        : String(Math.round(value))
}
export function fmtCompact(n: number | null | undefined): string {
    const v = n ?? 0
    if (!Number.isFinite(v) || v < 1_000) return String(v)
    if (v < 1_000_000) {
        const s = fmtUnit(v / 1_000, 10)
        if (s !== '1000') return s + 'K'
    }
    return fmtUnit(v / 1_000_000, 100) + 'M'
}
// Nexus fileSize is in KB. 164895 → "161 MB", 2048 → "2 MB", 512 → "512 KB".
export function fmtSize(kb: number | null | undefined): string {
    if (!kb || kb <= 0) return ''
    if (kb < 1_024) return Math.round(kb) + ' KB'
    if (kb < 1_048_576) {
        const mb = Math.round(kb / 1_024)
        if (mb < 1_024) return mb + ' MB'
    }
    return (kb / 1_048_576).toFixed(1).replace(/\.0$/, '') + ' GB'
}

// ── Image-source helpers ────────────────────────────────────────────────────────────────────────
// Prefer the relay-mirrored copy (host-relative `/images/nexus/…` served via /relay — needs the
// apiHost prefix in RN); fall back to the absolute Nexus CDN url. Ports nexusThumb()/nexusImage().
type ThumbLike = { localThumb?: string | null; thumbUrl?: string | null; imageUrl?: string | null }
type ImageLike = { localImage?: string | null; imageLargeUrl?: string | null; imageUrl?: string | null; thumbUrl?: string | null }

export function nexusThumbUri(mod: ThumbLike, apiHost: string | undefined): string | null {
    if (mod.localThumb) return apiHost ? `${apiHost}/relay${mod.localThumb}` : null
    return mod.thumbUrl ?? mod.imageUrl ?? null
}
export function nexusImageUri(mod: ImageLike, apiHost: string | undefined): string | null {
    if (mod.localImage) return apiHost ? `${apiHost}/relay${mod.localImage}` : null
    return mod.imageLargeUrl ?? mod.imageUrl ?? mod.thumbUrl ?? null
}
// The CDN url a broken relay-mirrored image should fall back to (ports nexusImgError's `cdn` arg).
export function nexusThumbFallback(mod: ThumbLike): string | null {
    return mod.thumbUrl ?? mod.imageUrl ?? null
}
export function galleryShotUri(g: NexusGalleryShot, apiHost: string | undefined): string | null {
    if (g.localUrl) return apiHost ? `${apiHost}/relay${g.localUrl}` : null
    return g.url ?? null
}
