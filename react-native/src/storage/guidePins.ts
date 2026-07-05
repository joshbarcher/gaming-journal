import AsyncStorage from '@react-native-async-storage/async-storage'

// Port of GuideViewer.svelte's pin persistence — same `guide-pins:{appid}:{source}:{guideId}` key
// convention and `{parsedAt, pins}` envelope as the web's localStorage version (not synced across
// platforms, just a matching naming convention), backed by AsyncStorage instead since RN has no
// localStorage.
//
// **`blockPath` addressing redesigned, not ported 1:1** (per PLAN.md's standing decision): the web
// computes `blockPath` by walking the *rendered DOM* up from a right-clicked element
// (`getBlockPath()` — child-index path from `.gv-content-inner`). RN has no persistent DOM to walk;
// instead, `ContentBlockRenderer` already knows each block's own index path at render time (it's
// literally how the tree is being iterated), so a long-pressed block reports its own `[..., i]`
// path directly — same shape (`number[]`, child-index path through nested `section` children), same
// semantics (stable across re-renders of the same content, breaks on re-download), computed from
// data instead of from a live DOM query. This is more reliable in principle, not a downgrade: a DOM
// walk can be thrown off by injected marker elements or renderer quirks; an index into the actual
// ContentBlock[] tree cannot.
export interface Pin {
    id:        string
    slug:      string        // base page slug, no #anchor
    pageLabel: string
    blockPath: number[]      // index path into the ContentBlock[] tree (see note above)
    label:     string        // text snippet extracted from the pinned block, ≤70 chars
}

export interface PinStoreShape {
    parsedAt: string | null
    pins:     Pin[]
}

function pinsKey(appid: number, source: string, guideId: string): string {
    return `guide-pins:${appid}:${source}:${guideId}`
}

export async function loadPinStore(appid: number, source: string, guideId: string): Promise<PinStoreShape> {
    try {
        const raw = await AsyncStorage.getItem(pinsKey(appid, source, guideId))
        if (!raw) return { parsedAt: null, pins: [] }
        const parsed = JSON.parse(raw)
        return { parsedAt: parsed.parsedAt ?? null, pins: Array.isArray(parsed.pins) ? parsed.pins : [] }
    } catch {
        return { parsedAt: null, pins: [] }
    }
}

export async function savePinStore(appid: number, source: string, guideId: string, store: PinStoreShape): Promise<void> {
    try {
        await AsyncStorage.setItem(pinsKey(appid, source, guideId), JSON.stringify(store))
    } catch { /* best-effort, matching the web's own silent catch around localStorage writes */ }
}

export async function clearPinStore(appid: number, source: string, guideId: string): Promise<void> {
    try {
        await AsyncStorage.removeItem(pinsKey(appid, source, guideId))
    } catch { /* ignore */ }
}

// Used by GuidesModalHost's re-download flow — needs a pin count for an arbitrary guide the user
// hasn't necessarily navigated into yet, independent of the "current guide" Zustand store.
export async function getPinCount(appid: number, source: string, guideId: string): Promise<number> {
    const store = await loadPinStore(appid, source, guideId)
    return store.pins.length
}
