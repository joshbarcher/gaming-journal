import { Image } from 'expo-image'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useGridColumns } from '@/hooks/useGridColumns'
import { openScreenshotLightbox } from '@/store/screenshotLightboxStore'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// Port of Screenshots.svelte + GamePage.svelte's lightbox (_openModal/_modalNav/_closeModal).
// If media.screenshots is empty, speculatively tries 25 numbered URLs (0.jpg…24.jpg) and relies on
// onError to hide broken ones — ported exactly, not invented.
//
// Column count mirrors the web grid `repeat(auto-fill, minmax(300px, 1fr))` (game.css:1124) via
// useGridColumns(300) — at the 1440dp desktop/tablet-landscape tier that fans out to 3 columns,
// matching the web (native previously hardcoded 2). Tile widths are computed in real pixels from the
// same window − rail − section-padding math useGridColumns uses, so the wrap grid has no stretched
// last row and shares the web's left edge (same convention as backlog/in-progress).
//
// Faithfully ported quirk, NOT fixed: the web's onclick passes `urls.filter((_,j)=>visible[j])`
// (the currently-visible list) but keeps `i` as the raw index into the ORIGINAL (unfiltered) urls
// array — if any earlier image in the grid failed to load, a later tile's raw index can run past
// the end of the filtered array the lightbox actually receives. This looks like a real latent bug
// in the web source (flagged during research, not something to silently "fix" in the port without
// asking) — replicated as-is here rather than corrected.
//
// Lightbox itself lives in ScreenshotLightboxHost (mounted at the app root, see
// store/screenshotLightboxStore.ts) instead of an embedded <Modal> here — a real bug was found
// where a Modal nested inside this scrolled screen (which sits under GameHero's Reanimated
// Animated.Views) rendered its "fixed" position relative to a transformed ancestor instead of the
// true viewport, on RN Web.
export function Screenshots({ appid, screenshots, apiHost }: { appid: number; screenshots: string[]; apiHost: string | undefined }) {
    const { width } = useWindowDimensions()
    const breakpoint = useBreakpoint()
    const collapsed = useSidebarStore(s => s.collapsed)

    // Web grid gap is 8px (game.css:1125); section has padding: spacing.md on each side (the game
    // body itself has no horizontal padding), so that 2*md is the only inset between rail and grid.
    const GAP = spacing.sm
    const columns = useGridColumns(300, { gap: GAP, horizontalPadding: spacing.md * 2 })
    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const rail = isPermanentRail ? (collapsed ? 68 : 280) : 0
    const contentWidth = Math.max(1, width - rail - spacing.md * 2)
    const tileWidth = Math.floor((contentWidth - GAP * (columns - 1)) / columns)

    const urls = useMemo(() => {
        if (screenshots.length > 0) return screenshots.map(p => `${apiHost}${p}`)
        if (!apiHost) return []
        return Array.from({ length: 25 }, (_, i) => `${apiHost}/relay/images/steam/screenshots/${appid}/${i}.jpg`)
    }, [screenshots, appid, apiHost])

    const [visible, setVisible] = useState<boolean[]>(() => urls.map(() => true))

    if (urls.length === 0) {
        return (
            <View style={styles.section}>
                <Text style={styles.title}>Screenshots</Text>
                <Text style={styles.empty}>No screenshots available.</Text>
            </View>
        )
    }

    // Same filtering the web performs at click time — see the faithfully-ported-quirk note above.
    const filteredUrls = urls.filter((_, j) => visible[j])
    const anyVisible = filteredUrls.length > 0

    return (
        <View style={styles.section}>
            <Text style={styles.title}>Screenshots</Text>
            {anyVisible ? (
                <View style={[styles.grid, { gap: GAP }]}>
                    {urls.map((url, i) => visible[i] && (
                        <Pressable
                            key={i}
                            style={[styles.tile, { width: tileWidth }]}
                            onPress={() => openScreenshotLightbox(filteredUrls, i)}
                        >
                            <Image
                                source={{ uri: url }}
                                style={styles.tileImage}
                                contentFit="cover"
                                onError={() => setVisible(v => { const next = [...v]; next[i] = false; return next })}
                            />
                        </Pressable>
                    ))}
                </View>
            ) : (
                <Text style={styles.empty}>No screenshots available.</Text>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    // Web .game-shot-item: aspect 16/9, 1px border, rounded, overflow hidden (game.css:1128).
    tile: { aspectRatio: 16 / 9, borderRadius: radius, overflow: 'hidden', backgroundColor: colors.bgHover, borderWidth: 1, borderColor: colors.border },
    tileImage: { width: '100%', height: '100%' },
})
