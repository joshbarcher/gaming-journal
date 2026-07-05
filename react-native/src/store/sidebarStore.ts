import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Port of +layout.svelte's sidebarCollapsed (localStorage-persisted pin toggle). Only meaningful
// on the permanent-sidebar tiers (tabletLandscape/desktop) — phone tiers keep the drawer and never
// read this.
type SidebarState = {
    collapsed: boolean
    toggle:    () => void
}

export const useSidebarStore = create<SidebarState>()(
    persist(
        (set, get) => ({
            collapsed: false,
            toggle:    () => set({ collapsed: !get().collapsed }),
        }),
        { name: 'gj:sidebar-collapsed', storage: createJSONStorage(() => AsyncStorage) }
    )
)
