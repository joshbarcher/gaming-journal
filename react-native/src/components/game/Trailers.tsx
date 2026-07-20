import { Image } from 'expo-image'
import { useEffect, useState } from 'react'
import { useVideoPlayer, VideoView } from 'expo-video'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { VideoEntry } from 'gaming-journal-contracts/videos'

// Port of Trailers.svelte. Web selects a trailer by imperatively reassigning one <video>'s
// src/poster (not a reactive src binding) — the RN equivalent is expo-video's player.replace(),
// called imperatively in an effect when the active index changes, matching that same
// "one persistent player, swap its source" model rather than remounting a new player per trailer.
//
// 2026-07-18 parity rework (secondary-thumbnail sizing): web's desktop `.trailers-layout` is a
// `minmax(0,50%) 1fr` grid — player left (up to 50%), thumbnail RAIL right (game.css:831-861). The
// rail (`.trailers-list`) is itself a 3-row, column-flow grid of 200px-wide thumbs (grid-auto-flow
// column, grid-auto-columns 200px), i.e. thumbs stack 3 per vertical column and wrap into new
// columns to the right, horizontally scrollable. Native mirrors this: trailers are chunked into
// columns of 3, each column a vertical stack of 200px-wide thumbs, inside a horizontal ScrollView.
// The rail is capped to the player's height (web clips via overflow-y:hidden). Previously native
// rendered a single vertical rail whose thumbs blew up to ~half the section width — the wrong size
// the user flagged. Narrow widths keep the web's stacked collapse (player above a horizontal thumb
// strip, 180px thumbs). Width is measured via onLayout so it tracks the drawer rail collapsing.
export function Trailers({ appid, trailers, apiHost }: { appid: number; trailers: VideoEntry[]; apiHost: string | undefined }) {
    const [activeIdx, setActiveIdx] = useState(0)
    const [width, setWidth] = useState(0)
    const wide = width >= 700

    const initialUri = apiHost ? `${apiHost}/relay/videos/steam/${appid}/${trailers[0]?.index ?? 0}.mp4` : null
    const player = useVideoPlayer(initialUri, p => { p.loop = false })

    useEffect(() => {
        if (!apiHost) return
        const uri = `${apiHost}/relay/videos/steam/${appid}/${trailers[activeIdx]?.index ?? activeIdx}.mp4`
        player.replace(uri)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- player identity is stable from useVideoPlayer
    }, [activeIdx, apiHost, appid])

    if (!trailers.length) return null

    // Player is 50% of the inner row (minus the 12px column gap); the rail is capped to the player's
    // 16:9 height so a 3-high column of thumbs clips like the web's overflow-y:hidden instead of
    // pushing the section taller than the player.
    const innerW = Math.max(0, width - spacing.md * 2)
    const playerW = (innerW - spacing.md) / 2
    const playerH = (playerW * 9) / 16

    // Chunk into columns of 3 to mirror the web rail's `grid-template-rows: repeat(3,1fr)` +
    // `grid-auto-flow: column`.
    const railColumns: VideoEntry[][] = []
    for (let i = 0; i < trailers.length; i += 3) railColumns.push(trailers.slice(i, i + 3))

    const renderThumb = (t: VideoEntry, i: number) => (
        <Pressable
            key={i}
            style={StyleSheet.flatten([styles.thumb, { width: wide ? 200 : 180 }, i === activeIdx && styles.thumbActive])}
            onPress={() => setActiveIdx(i)}
        >
            <View style={styles.thumbImgWrap}>
                {t.thumbnail && <Image source={{ uri: t.thumbnail }} style={styles.thumbImage} contentFit="cover" />}
                <View style={styles.thumbPlayOverlay}>
                    <Text style={styles.thumbPlayIcon}>▶</Text>
                </View>
            </View>
            <Text style={[styles.thumbName, i === activeIdx && styles.thumbNameActive]} numberOfLines={1}>
                {t.name ?? `Trailer ${i + 1}`}
            </Text>
        </Pressable>
    )

    return (
        <View style={styles.section} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
            <Text style={styles.title}>Trailers</Text>
            {wide ? (
                <View style={styles.layoutWide}>
                    <View style={styles.playerWrapWide}>
                        <VideoView player={player} style={styles.playerFill} nativeControls contentFit="contain" />
                    </View>
                    {trailers.length > 1 && (
                        <ScrollView
                            horizontal
                            style={[styles.railWide, { maxHeight: playerH || undefined }]}
                            contentContainerStyle={styles.railContent}
                            showsHorizontalScrollIndicator={false}
                        >
                            {railColumns.map((col, ci) => (
                                <View key={ci} style={styles.railColumn}>
                                    {col.map((t, j) => renderThumb(t, ci * 3 + j))}
                                </View>
                            ))}
                        </ScrollView>
                    )}
                </View>
            ) : (
                <>
                    <View style={styles.playerWrapNarrow}>
                        <VideoView player={player} style={styles.playerFill} nativeControls contentFit="contain" />
                    </View>
                    {trailers.length > 1 && (
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={styles.thumbRow}
                            contentContainerStyle={styles.railContent}
                        >
                            {trailers.map((t, i) => renderThumb(t, i))}
                        </ScrollView>
                    )}
                </>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },

    // Web .trailers-player-wrap: 16:9, rounded, black, 1px #474747 border (game.css:838).
    playerWrapWide: { flexBasis: '50%', maxWidth: '50%', flexShrink: 1, aspectRatio: 16 / 9, borderRadius: radius, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: '#474747' },
    playerWrapNarrow: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: '#474747' },
    playerFill: { width: '100%', height: '100%' },

    // Wide (desktop): player left (50%), thumbnail rail right (1fr), matching `minmax(0,50%) 1fr`.
    layoutWide: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    railWide: { flex: 1 },
    railContent: { gap: spacing.sm },
    railColumn: { gap: spacing.sm },

    thumbRow: { marginTop: spacing.sm },

    // Web .trailers-thumb: raised bg, 1px border, rounded, overflow hidden (game.css:863). 200px wide
    // on desktop (grid-auto-columns), 180px in the narrow horizontal strip (game.css:2651).
    thumb: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: 'hidden' },
    thumbActive: { borderColor: colors.borderAct },
    thumbImgWrap: { aspectRatio: 16 / 9, backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
    thumbImage: { width: '100%', height: '100%' },
    // Web .trailers-play-icon: full-cover overlay, rgba(0,0,0,0.35), 20px, rgba(255,255,255,0.85).
    thumbPlayOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
    thumbPlayIcon: { color: 'rgba(255,255,255,0.85)', fontSize: 20 },
    // Web .trailers-thumb-name: 7px/10px padding, 11px, muted, single-line ellipsis (game.css:917).
    thumbName: { paddingVertical: 7, paddingHorizontal: 10, fontSize: 11, color: colors.textMuted, fontFamily: fonts.ui },
    thumbNameActive: { color: colors.text },
})
