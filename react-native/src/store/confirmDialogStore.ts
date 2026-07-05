// Backs ConfirmDialog.tsx — the web app's confirmDialog() (src/lib/js/dialog.ts) builds an
// imperative DOM overlay on the fly and returns a Promise<boolean>. RN has no document.body to
// append to, so the same call-site API is kept (confirmDialog(title, body, confirmLabel) resolving
// true/false) but backed by a Zustand-held state + a single <ConfirmDialogHost/> mounted once at
// the app root that renders the actual <Modal/>.
import { create } from 'zustand'

type ConfirmDialogState = {
    visible:      boolean
    title:        string
    body:         string
    confirmLabel: string
    resolve:      ((result: boolean) => void) | null
    open:  (title: string, body: string, confirmLabel: string, resolve: (result: boolean) => void) => void
    close: (result: boolean) => void
}

export const useConfirmDialogStore = create<ConfirmDialogState>((set, get) => ({
    visible:      false,
    title:        '',
    body:         '',
    confirmLabel: 'Confirm',
    resolve:      null,
    open: (title, body, confirmLabel, resolve) => set({ visible: true, title, body, confirmLabel, resolve }),
    close: (result) => {
        get().resolve?.(result)
        set({ visible: false, resolve: null })
    },
}))

export function confirmDialog(title: string, body: string, confirmLabel = 'Confirm'): Promise<boolean> {
    return new Promise(resolve => {
        useConfirmDialogStore.getState().open(title, body, confirmLabel, resolve)
    })
}
