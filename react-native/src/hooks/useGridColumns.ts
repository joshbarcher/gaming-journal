import { useWindowDimensions } from 'react-native'

import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useSidebarStore } from '@/store/sidebarStore'

// Fluid column count that mirrors the web's `grid-template-columns: repeat(auto-fill, minmax(Npx,1fr))`.
// The web fans grids out to as many columns as fit; native was hardcoding `mobilePortrait ? 2 : 3`,
// which capped a 1440dp (desktop-tier) tablet at the phone/small-tablet density. Driving off the
// measured content width keeps parity at any width and as the permanent rail collapses (280↔68).
//
// contentWidth = window width − the permanent rail (only on tablet-landscape/desktop tiers; the
// phone drawer is an overlay and takes no layout width). The auto-fill count for a container is
// floor((content + gap) / (minItemWidth + gap)).
export function useGridColumns(
    minItemWidth: number,
    opts: { gap?: number; min?: number; max?: number; horizontalPadding?: number } = {},
): number {
    const { gap = 12, min = 1, max, horizontalPadding = 0 } = opts
    const { width } = useWindowDimensions()
    const breakpoint = useBreakpoint()
    const collapsed = useSidebarStore(s => s.collapsed)

    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const rail = isPermanentRail ? (collapsed ? 68 : 280) : 0
    const content = Math.max(0, width - rail - horizontalPadding)

    const cols = Math.max(min, Math.floor((content + gap) / (minItemWidth + gap)))
    return max ? Math.min(cols, max) : cols
}
