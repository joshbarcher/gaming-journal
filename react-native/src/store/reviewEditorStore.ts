// Backs ReviewEditor.tsx — mounted once at the app root (like ConfirmDialogHost/
// ScreenshotLightboxHost) per the standing rule established while building the Game detail
// screen's screenshot lightbox: any full-screen overlay must be a root-mounted Zustand-store-backed
// host, never a <Modal> embedded inside a scrolled screen.
import { create } from 'zustand'

import type { LocalReview } from 'gaming-journal-contracts/localReview'

type ReviewEditorState = {
    visible: boolean
    appid: number | null
    existing: LocalReview | null
    open: (appid: number, existing: LocalReview | null) => void
    close: () => void
}

export const useReviewEditorStore = create<ReviewEditorState>((set) => ({
    visible: false,
    appid: null,
    existing: null,
    open: (appid, existing) => set({ visible: true, appid, existing }),
    close: () => set({ visible: false }),
}))

export function openReviewEditor(appid: number, existing: LocalReview | null): void {
    useReviewEditorStore.getState().open(appid, existing)
}
