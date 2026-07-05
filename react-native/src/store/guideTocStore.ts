// Backs GuideTocHost.tsx — root-mounted overlay (see PLAN.md's standing rule), same family as
// ConfirmDialogHost/GuidesModalHost. Port of GuideViewer.svelte's TOC sidebar, **redesigned as a
// bottom-sheet drawer** per this item's own stated scope, not the web's permanent 300px/40px
// collapsible grid column — a fixed-width side column makes no sense on a 360px-wide phone, and an
// open/closed sheet has no equivalent need for the web's "collapsed 40px strip with numbered
// badges" screen-space-reclaiming affordance (that trick exists purely to avoid wasting desktop
// width; a sheet is either open or fully gone).
//
// **Pins section deliberately absent** — Guide Pins is its own later TODO item
// ("guides/pins.md — redesigned to {blockIndex,offset} addressing"), and no pin storage exists in
// RN yet at all. This store only ever holds `navTree`/`pages`/`author`/`currentSlug`, matching what
// this item is actually scoped to build.
import { create } from 'zustand'

import type { GuideMeta } from 'gaming-journal-contracts/guideMeta'

type GuideTocState = {
    visible: boolean
    appid: number | null
    source: string
    guideId: string
    meta: GuideMeta | null
    currentSlug: string | null
    open: (appid: number, source: string, guideId: string, meta: GuideMeta, currentSlug: string | null) => void
    close: () => void
}

export const useGuideTocStore = create<GuideTocState>((set) => ({
    visible: false,
    appid: null,
    source: '',
    guideId: '',
    meta: null,
    currentSlug: null,
    open: (appid, source, guideId, meta, currentSlug) => set({ visible: true, appid, source, guideId, meta, currentSlug }),
    close: () => set({ visible: false }),
}))
