// Breakpoint tiers — NOT invented for RN. These are the exact three thresholds already used
// consistently across every file in gaming-journal's public/css/*.css (confirmed via grep across
// ~30 stylesheets: library.css, game.css, layout.css, sidebar.css, etc. all use precisely
// max-width: 1279px / 799px / 479px, with a min-width: 1280px "desktop" tier above that). Reusing
// them keeps the RN app's responsive decisions consistent with the web app's already-battle-tested
// ones, per the standing rule in PLAN.md: check the web CSS before inventing new breakpoint logic.
import { useWindowDimensions } from 'react-native'

export type Breakpoint =
    | 'mobilePortrait'                  // web: max-width 479px
    | 'mobileLandscapeTabletPortrait'   // web: 480px – 799px
    | 'tabletLandscape'                 // web: 800px – 1279px
    | 'desktop'                         // web: min-width 1280px (sidebar-permanent tier; RN's 3
                                        // required tiers top out at 1279, this exists so nothing
                                        // silently falls through if a device is ever wider)

export function breakpointForWidth(width: number): Breakpoint {
    if (width <= 479) return 'mobilePortrait'
    if (width <= 799) return 'mobileLandscapeTabletPortrait'
    if (width <= 1279) return 'tabletLandscape'
    return 'desktop'
}

export function useBreakpoint(): Breakpoint {
    const { width } = useWindowDimensions()
    return breakpointForWidth(width)
}
