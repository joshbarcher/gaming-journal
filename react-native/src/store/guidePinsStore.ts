// Holds the pins for whichever guide is currently open (landing or a section page) — read by the
// section screen (highlighting/auto-scroll), the landing screen and section screen (both can open
// the TOC drawer, which shows the Pins list), and GuideTocHost itself. Only one guide can be open
// at a time in this app, so a single global store mirrors GuideViewer.svelte's own component-scoped
// `pins`/`staleNotice` state closely enough.
import { create } from 'zustand'

import { loadPinStore, cachePinStore, upsertPinRemote, deletePinRemote, type Pin } from '@/storage/guidePins'

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
        // Pins are durable across re-parses: the relay re-anchors them to the current content
        // by text on GET (pins.service reanchorPinList), so we adopt whatever it returns rather
        // than wiping on a parsedAt change. A pin whose block genuinely vanished stays in the
        // list; the section screen simply doesn't highlight/scroll to it.
        // NOTE: healed blockPaths use the web/_fulltext coordinate (section children offset by
        // +1 for the heading), which differs from this app's data-tree indices — so in-section
        // scroll can be off by one until native re-anchoring lands (tracked as a follow-up).
        set({ appid, source, guideId, parsedAt: currentParsedAt, pins: stored.pins, staleNotice: false })
    },

    // Add or replace this page's pin via a per-pin server delta (PUT .../pins/:id), mirroring the
    // web's upsertPinRemote: optimistically patch local state for instant feedback, then adopt the
    // authoritative store the relay returns (which merges in pins added on other devices). A stale
    // full-array PUT would clobber those other-device pins — see storage/guidePins.ts's own note.
    createPin: async (slug, pageLabel, blockPath, label) => {
        const { appid, source, guideId, parsedAt, pins } = get()
        if (!appid) return
        const existing = pins.find(p => p.slug === slug)
        const pin: Pin = { id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, slug, pageLabel, blockPath, label }
        // One pin per page: optimistically replace any local pin on this page (the relay enforces
        // the same rule by slug, so a stale snapshot can't create a duplicate).
        const optimistic = existing ? pins.map(p => (p.slug === slug ? pin : p)) : [...pins, pin]
        set({ pins: optimistic })
        cachePinStore(appid, source, guideId, { parsedAt, pins: optimistic }) // survive an offline reload
        try {
            const store = await upsertPinRemote(appid, source, guideId, pin, parsedAt)
            set({ pins: store.pins })
        } catch { /* offline — keep the optimistic state (already cached) */ }
    },

    // Remove a single pin via a per-pin server delta (DELETE .../pins/:id) — targets one pin, so it
    // can never wipe pins this device never saw. Optimistic, then reconcile with the relay's store.
    deletePin: async (id) => {
        const { appid, source, guideId, parsedAt, pins } = get()
        if (!appid) return
        const optimistic = pins.filter(p => p.id !== id)
        set({ pins: optimistic })
        cachePinStore(appid, source, guideId, { parsedAt, pins: optimistic })
        try {
            const store = await deletePinRemote(appid, source, guideId, id)
            set({ pins: store.pins })
        } catch { /* offline — keep the optimistic removal (already cached) */ }
    },

    dismissStaleNotice: () => set({ staleNotice: false }),
    requestScroll: (path) => set({ scrollRequest: { path, nonce: Date.now() } }),
    pinFor: (slug) => get().pins.find(p => p.slug === slug),
}))
