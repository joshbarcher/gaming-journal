// Backs LongPressMenu.tsx — the touch replacement for the web app's right-click context menu
// (src/lib/js/views/context-menu.ts). That version does hover-driven flyout submenus positioned
// at cursor coordinates; touch has neither hover nor a meaningful "cursor position" for a small
// screen, so this is a drill-down action sheet instead: selecting an item with a submenu pushes a
// new level (with a Back row) rather than opening a sideways flyout. Same MenuItem/ContextMenuItem
// shape as the web version, including async submenu loaders (shown as a "Loading…" placeholder
// row while resolving, matching web semantics).
import { create } from 'zustand'

export interface MenuItem {
    label:     string
    action?:   () => void
    danger?:   boolean
    disabled?: boolean
    external?: boolean // shows a "opens externally" affordance
    submenu?:  ContextMenuItem[] | (() => Promise<ContextMenuItem[]>)
}

export type ContextMenuItem = MenuItem | 'separator'

type Level = {
    label: string | null // null for the root level (no Back row)
    items: ContextMenuItem[] | 'loading' | 'error'
}

type LongPressMenuState = {
    visible: boolean
    levels:  Level[] // stack; last entry is what's currently shown
    open:    (items: ContextMenuItem[]) => void
    select:  (item: MenuItem) => void
    back:    () => void
    close:   () => void
}

export const useLongPressMenuStore = create<LongPressMenuState>((set, get) => ({
    visible: false,
    levels:  [],

    open: (items) => set({ visible: true, levels: [{ label: null, items }] }),

    select: (item) => {
        if (item.disabled) return

        if (item.submenu) {
            const levels = [...get().levels, { label: item.label, items: 'loading' as const }]
            set({ levels })
            const myDepth = levels.length

            if (Array.isArray(item.submenu)) {
                set(state => {
                    if (state.levels.length !== myDepth) return state // menu moved on already
                    const next = [...state.levels]
                    next[myDepth - 1] = { label: item.label, items: item.submenu as ContextMenuItem[] }
                    return { levels: next }
                })
                return
            }

            item.submenu().then(resolved => {
                set(state => {
                    if (state.levels.length !== myDepth) return state
                    const next = [...state.levels]
                    next[myDepth - 1] = {
                        label: item.label,
                        items: resolved.length ? resolved : [{ label: 'Nothing found', disabled: true }],
                    }
                    return { levels: next }
                })
            }).catch(() => {
                set(state => {
                    if (state.levels.length !== myDepth) return state
                    const next = [...state.levels]
                    next[myDepth - 1] = { label: item.label, items: [{ label: 'Failed to load', disabled: true }] }
                    return { levels: next }
                })
            })
            return
        }

        if (item.action) {
            item.action()
            set({ visible: false, levels: [] })
        }
    },

    back: () => set(state => ({ levels: state.levels.slice(0, -1) })),

    close: () => set({ visible: false, levels: [] }),
}))

export function openLongPressMenu(items: ContextMenuItem[]): void {
    useLongPressMenuStore.getState().open(items)
}
