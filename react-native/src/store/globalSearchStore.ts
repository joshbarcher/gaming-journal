import { create } from 'zustand'

// Touch redesign of global/global-search.md: no Ctrl+Space (no keyboard on touch), so this is
// opened via a persistent search icon in the drawer header instead — see GlobalSearch.tsx. No
// arrow-key navigation either — tap-to-select replaces it, which is simpler than the desktop
// version, not a downgrade (per PLAN.md's touch-adaptation rule).
type GlobalSearchState = {
    open:       boolean
    setOpen:    (open: boolean) => void
}

export const useGlobalSearchStore = create<GlobalSearchState>((set) => ({
    open:    false,
    setOpen: (open) => set({ open }),
}))
