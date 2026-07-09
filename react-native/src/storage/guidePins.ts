import AsyncStorage from '@react-native-async-storage/async-storage'

import { apiGet, apiPut } from '@/api/client'
import { GuidePinsSchema, type GuidePin } from 'gaming-journal-contracts/guidePins'

// Guide TOC pins now live on the server (GET/PUT /relay/api/guides/{appid}/{source}/{guideId}/pins)
// so the web app and this app share one set of pins. AsyncStorage is kept only as (a) an offline
// read cache and (b) the migration source for pins created before the server move.
//
// `blockPath` is an index path into the rendered ContentBlock[] tree — same shape/semantics as the
// web's, stable across re-renders of the same content, invalidated when the guide is re-downloaded.
export type Pin = GuidePin

export interface PinStoreShape {
    parsedAt: string | null
    pins:     Pin[]
}

const EMPTY: PinStoreShape = { parsedAt: null, pins: [] }

function pinsPath(appid: number, source: string, guideId: string): string {
    return `/relay/api/guides/${appid}/${source}/${encodeURIComponent(guideId)}/pins`
}

// Legacy/offline cache key (unchanged from the pre-server version).
function cacheKey(appid: number, source: string, guideId: string): string {
    return `guide-pins:${appid}:${source}:${guideId}`
}

async function readCache(appid: number, source: string, guideId: string): Promise<PinStoreShape> {
    try {
        const raw = await AsyncStorage.getItem(cacheKey(appid, source, guideId))
        if (!raw) return EMPTY
        const parsed = JSON.parse(raw)
        return { parsedAt: parsed.parsedAt ?? null, pins: Array.isArray(parsed.pins) ? parsed.pins : [] }
    } catch {
        return EMPTY
    }
}

async function writeCache(appid: number, source: string, guideId: string, store: PinStoreShape): Promise<void> {
    try { await AsyncStorage.setItem(cacheKey(appid, source, guideId), JSON.stringify(store)) } catch { /* best-effort */ }
}

export async function loadPinStore(appid: number, source: string, guideId: string): Promise<PinStoreShape> {
    try {
        const server = await apiGet(pinsPath(appid, source, guideId), GuidePinsSchema)
        if (server.pins.length > 0) {
            void writeCache(appid, source, guideId, server)
            return server
        }
        // Server has nothing yet — migrate any legacy on-device pins up to it (one-time).
        const legacy = await readCache(appid, source, guideId)
        if (legacy.pins.length > 0) {
            await savePinStore(appid, source, guideId, legacy)
            return legacy
        }
        return server
    } catch {
        // Offline or server error — serve the local cache so pins still show.
        return readCache(appid, source, guideId)
    }
}

export async function savePinStore(appid: number, source: string, guideId: string, store: PinStoreShape): Promise<void> {
    void writeCache(appid, source, guideId, store) // optimistic offline cache
    try {
        await apiPut(pinsPath(appid, source, guideId), GuidePinsSchema, { parsedAt: store.parsedAt ?? null, pins: store.pins })
    } catch { /* kept in cache; the next save retries the whole list */ }
}

export async function clearPinStore(appid: number, source: string, guideId: string): Promise<void> {
    await savePinStore(appid, source, guideId, { parsedAt: null, pins: [] })
}

// Used by GuidesModalHost's re-download flow — a pin count for a guide the user may not have open.
export async function getPinCount(appid: number, source: string, guideId: string): Promise<number> {
    const store = await loadPinStore(appid, source, guideId)
    return store.pins.length
}
