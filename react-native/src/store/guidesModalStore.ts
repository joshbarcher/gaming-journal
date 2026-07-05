// Backs GuidesModalHost.tsx — root-mounted overlay, same pattern as ConfirmDialogHost/
// ScreenshotLightboxHost/ReviewEditor (see PLAN.md's standing rule: any full-screen overlay must be
// a root-mounted Zustand host, never a <Modal> embedded inside a scrolled screen). Ported from
// GuidesModal.svelte + JournalDashboard.svelte's runSearch()/refreshSearch()/mergeSource() — the
// Svelte version keeps this state on the dashboard component and passes it down as props; here the
// store owns it directly (matching ReviewEditor's "self-contained store with its own async actions"
// shape) so the modal can be opened from anywhere without prop drilling.
import { create } from 'zustand'

import { GUIDE_SOURCES, type GuideSearchData, type GuideSource } from 'gaming-journal-contracts/guideSearch'
import { runGuideSearch } from '@/api/guides'
import type { DownloadedGuide } from 'gaming-journal-contracts/downloadedGuides'

type GuidesModalState = {
    visible:       boolean
    appid:         number | null
    gameName:      string
    guides:        DownloadedGuide[]
    searchData:    GuideSearchData | null
    searchingSet:  Set<string>
    activeSource:  GuideSource
    activeCategory: string

    open:  (appid: number, gameName: string, guides: DownloadedGuide[], searchData: GuideSearchData | null) => void
    close: () => void
    setActiveSource:   (src: GuideSource) => void
    setActiveCategory: (cat: string) => void
    setGuides:     (guides: DownloadedGuide[]) => void
    runSearch:     (source: GuideSource) => Promise<void>
    refreshSearch: () => Promise<void>
}

export const useGuidesModalStore = create<GuidesModalState>((set, get) => ({
    visible:  false,
    appid:    null,
    gameName: '',
    guides:   [],
    searchData: null,
    searchingSet: new Set(),
    activeSource: GUIDE_SOURCES[0],
    activeCategory: '',

    open: (appid, gameName, guides, searchData) => set({
        visible: true, appid, gameName, guides, searchData,
        searchingSet: new Set(), activeSource: GUIDE_SOURCES[0], activeCategory: '',
    }),
    close: () => set({ visible: false }),
    setActiveSource:   (activeSource) => set({ activeSource, activeCategory: '' }),
    setActiveCategory: (activeCategory) => set({ activeCategory }),
    setGuides: (guides) => set({ guides }),

    async runSearch(source) {
        const { appid, gameName, searchingSet } = get()
        if (!appid || !gameName || searchingSet.has(source)) return
        set({ searchingSet: new Set([...get().searchingSet, source]) })
        try {
            await runGuideSearch(appid, gameName, source, {
                onEvent: (event) => {
                    if (event.phase === 'done') {
                        const entry = event.data.sources[source]
                        if (entry) {
                            set(state => ({
                                searchData: {
                                    steamId: state.searchData?.steamId ?? String(appid),
                                    sources: { ...(state.searchData?.sources ?? {}), [source]: entry },
                                },
                            }))
                        }
                    }
                },
            })
        } finally {
            set(state => {
                const next = new Set(state.searchingSet)
                next.delete(source)
                return { searchingSet: next }
            })
        }
    },

    async refreshSearch() {
        await Promise.all(GUIDE_SOURCES.map(src => get().runSearch(src)))
    },
}))
