// Backs ScreenshotLightbox.tsx. Mounted once at the app root (like ConfirmDialogHost/
// LongPressMenuHost) rather than as a <Modal> embedded inside the Game detail screen's own
// component tree — required after a real bug: a Modal nested inside a scrolled page containing
// Reanimated Animated.Views (GameHero's HeroCrossfade) rendered with `position:fixed` computed
// relative to a transformed ancestor instead of the true viewport, on RN Web. The result: opening
// the lightbox after scrolling down showed a gap at the true viewport top with page content
// bleeding through, because the "fixed" modal was actually offset by the scroll amount. Every
// other modal-like overlay in this app (ConfirmDialog, LongPressMenu) already avoids this by
// living at the root, outside of any transformed/animated ancestor — this follows the same fix.
import { create } from 'zustand'

type LightboxState = {
    visible: boolean
    urls: string[]
    index: number
    open: (urls: string[], index: number) => void
    close: () => void
    next: () => void
    prev: () => void
}

export const useScreenshotLightboxStore = create<LightboxState>((set, get) => ({
    visible: false,
    urls: [],
    index: 0,
    open: (urls, index) => set({ visible: true, urls, index }),
    close: () => set({ visible: false }),
    next: () => set(state => ({ index: state.urls.length ? (state.index + 1) % state.urls.length : 0 })),
    prev: () => set(state => ({ index: state.urls.length ? (state.index - 1 + state.urls.length) % state.urls.length : 0 })),
}))

export function openScreenshotLightbox(urls: string[], index: number): void {
    useScreenshotLightboxStore.getState().open(urls, index)
}
