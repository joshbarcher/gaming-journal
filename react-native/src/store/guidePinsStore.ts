// Holds the pins for whichever guide is currently open (landing or a section page) — read by the
// section screen (highlighting/auto-scroll), the landing screen and section screen (both can open
// the TOC drawer, which shows the Pins list), and GuideTocHost itself. Only one guide can be open
// at a time in this app, so a single global store mirrors GuideViewer.svelte's own component-scoped
// `pins`/`staleNotice` state closely enough.
import { create } from 'zustand'

import { clearPinStore, loadPinStore, savePinStore, type Pin } from '@/storage/guidePins'

type GuidePinsState = {
    appid:    number | null
    source:   string
    guideId:  string
    parsedAt: string | null
    pins:     Pin[]
    staleNotice: boolean
    // Pub/sub scroll request: the TOC drawer (root-mounted, no direct handle to the section
    // screen's ScrollView ref) sets this when the user taps a pin for the page they're *already*
    // viewing; the section screen watches it and performs the actual scroll. Cross-page pin taps
    // don't need this — navigating to a different page and auto-scrolling to its own saved pin on
    // mount (already-built behavior) covers that case without any pub/sub at all.
    scrollRequest: { path: number[]; nonce: number } | null

    loadForGuide: (appid: number, source: string, guideId: string, currentParsedAt: string | null) => Promise<void>
    createPin: (slug: string, pageLabel: string, blockPath: number[], label: string) => Promise<void>
    deletePin: (id: string) => Promise<void>
    dismissStaleNotice: () => void
    requestScroll: (path: number[]) => void
    pinFor: (slug: string) => Pin | undefined
}

export const useGuidePinsStore = create<GuidePinsState>((set, get) => ({
    appid: null, source: '', guideId: '', parsedAt: null, pins: [], staleNotice: false, scrollRequest: null,

    loadForGuide: async (appid, source, guideId, currentParsedAt) => {
        const stored = await loadPinStore(appid, source, guideId)
        // Stale detection ported verbatim from loadPins(): if both parsedAt values are known and
        // differ, the guide was re-downloaded since these pins were saved — their blockPath
        // indices may no longer point at the same content, so clear them and flag the notice.
        if (currentParsedAt && stored.parsedAt && stored.parsedAt !== currentParsedAt) {
            await clearPinStore(appid, source, guideId)
            set({ appid, source, guideId, parsedAt: currentParsedAt, pins: [], staleNotice: true })
        } else {
            set({ appid, source, guideId, parsedAt: currentParsedAt, pins: stored.pins, staleNotice: false })
        }
    },

    createPin: async (slug, pageLabel, blockPath, label) => {
        const { appid, source, guideId, parsedAt, pins } = get()
        if (!appid) return
        const existing = pins.find(p => p.slug === slug)
        const pin: Pin = { id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, slug, pageLabel, blockPath, label }
        const updated = existing ? pins.map(p => (p.slug === slug ? pin : p)) : [...pins, pin]
        set({ pins: updated })
        await savePinStore(appid, source, guideId, { parsedAt, pins: updated })
    },

    deletePin: async (id) => {
        const { appid, source, guideId, parsedAt, pins } = get()
        if (!appid) return
        const updated = pins.filter(p => p.id !== id)
        set({ pins: updated })
        await savePinStore(appid, source, guideId, { parsedAt, pins: updated })
    },

    dismissStaleNotice: () => set({ staleNotice: false }),
    requestScroll: (path) => set({ scrollRequest: { path, nonce: Date.now() } }),
    pinFor: (slug) => get().pins.find(p => p.slug === slug),
}))
