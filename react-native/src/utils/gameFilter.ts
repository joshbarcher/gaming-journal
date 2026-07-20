// Ported from src/lib/js/views/game-filter.ts's loadGameFilter()/shouldShow(). Same gating logic
// already inlined once for Calendar's buildDayMap/buildLastPlayedOverlay (flags/settings passed
// straight into those pure functions there); factored out here as a real shared predicate since
// Account is the second screen that needs it standalone.
import type { FlagsStore } from 'gaming-journal-contracts/flags'
import type { Settings } from 'gaming-journal-contracts/settings'

export function makeShouldShow(flags: FlagsStore, settings: Partial<Settings>) {
    return function shouldShow(appid: string | number): boolean {
        const f = flags[String(appid)] ?? {}
        if (f.childLock && !settings.showChildLocked) return false
        if (f.filtered && !settings.showFiltered) return false
        if (f.software && !settings.showSoftware) return false
        return true
    }
}
