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
export function Trailers({ appid, trailers, apiHost }: { appid: number; trailers: VideoEntry[]; apiHost: string | undefined }) {
    const [activeIdx, setActiveIdx] = useState(0)

    const initialUri = apiHost ? `${apiHost}/relay/videos/steam/${appid}/${trailers[0]?.index ?? 0}.mp4` : null
    const player = useVideoPlayer(initialUri, p => { p.loop = false })

    useEffect(() => {
        if (!apiHost) return
        const uri = `${apiHost}/relay/videos/steam/${appid}/${trailers[activeIdx]?.index ?? activeIdx}.mp4`
        player.replace(uri)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- player identity is stable from useVideoPlayer
    }, [activeIdx, apiHost, appid])

    if (!trailers.length) return null

    return (
        <View style={styles.section}>
            <Text style={styles.title}>Trailers</Text>
            <VideoView player={player} style={styles.player} nativeControls contentFit="contain" />
            {trailers.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                    {trailers.map((t, i) => (
                        <Pressable
                            key={i}
                            style={StyleSheet.flatten([styles.thumb, i === activeIdx && styles.thumbActive])}
                            onPress={() => setActiveIdx(i)}
                        >
                            {t.thumbnail && <Image source={{ uri: t.thumbnail }} style={styles.thumbImage} contentFit="cover" />}
                            <Text style={styles.thumbPlay}>▶</Text>
                            <Text style={styles.thumbLabel} numberOfLines={1}>{t.name ?? `Trailer ${i + 1}`}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    player: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius, backgroundColor: colors.bgHover },
    thumbRow: { marginTop: spacing.sm },
    thumb: { width: 160, marginRight: spacing.sm, borderRadius: radius, overflow: 'hidden', backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border },
    thumbActive: { borderColor: colors.borderAct },
    thumbImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bgHover },
    thumbPlay: { position: 'absolute', top: '35%', left: '45%', color: '#fff', fontSize: 16 },
    thumbLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, padding: 4 },
})
