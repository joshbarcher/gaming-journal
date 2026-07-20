import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'

import { AchievementIconRow } from '@/components/journal/AchievementIconRow'
import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtDate } from '@/utils/journalRender'
import type { AchievementItem } from 'gaming-journal-contracts/achievements'
import type { JournalSession, SessionAchievement } from 'gaming-journal-contracts/journalSessions'

// Port of LastSessionCard.svelte. Two states over the SAME game-header art background:
//   • Last Session — art dimmed to 0.18 (.gj-card--game-bg), the most recent session's duration.
//   • Playing Now  — full-brightness art + directional dark scrim (.gj-card--playing-bg), a gold
//     border with a gentle throb (.gj-card--active-session glow), the live elapsed "so far", and the
//     achievements earned during the current session.
// The web dashboard DOES pass the active session in (JournalDashboard.svelte:537-544) — the card
// flips itself; the caller just supplies isActive/activeElapsed/activeAchs.
export function LastSessionCard({ sessions, achievements, apiHost, appid, isActive = false, activeElapsed = '—', activeAchs = [] }: {
    sessions: JournalSession[]
    achievements: AchievementItem[]
    apiHost: string | undefined
    appid: number
    isActive?: boolean
    activeElapsed?: string
    activeAchs?: SessionAchievement[]
}) {
    const sorted = [...sessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    const last = sorted[0] ?? null
    const achMap = new Map(achievements.map(a => [a.apiname, a]))

    const resolve = (a: SessionAchievement) => ({
        apiname: a.apiname,
        displayName: achMap.get(a.apiname)?.displayName,
        icon: achMap.get(a.apiname)?.icon,
        localIcon: achMap.get(a.apiname)?.localIcon,
    })

    const bgUri = apiHost ? `${apiHost}/relay/images/steam/games/${appid}/header.jpg` : undefined

    // Gentle gold throb on the active border (analog of .gj-card--active-session's box-shadow glow —
    // opacity is native-driver-safe; box-shadow animation is not portable). Runs only while playing.
    const glow = useRef(new Animated.Value(0.4)).current
    useEffect(() => {
        if (!isActive) return
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(glow, { toValue: 1, duration: 1800, useNativeDriver: true }),
            Animated.timing(glow, { toValue: 0.4, duration: 1800, useNativeDriver: true }),
        ]))
        loop.start()
        return () => loop.stop()
    }, [isActive, glow])

    if (isActive) {
        const earned = activeAchs.map(resolve)
        return (
            <View style={[styles.card, styles.activeCard]}>
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    {bgUri && <Image source={{ uri: bgUri }} style={StyleSheet.absoluteFill} contentFit="cover" />}
                    <LinearGradient
                        colors={['rgba(12,18,14,0.94)', 'rgba(12,18,14,0.72)', 'rgba(12,18,14,0.32)', 'rgba(12,18,14,0.10)']}
                        locations={[0, 0.38, 0.72, 1]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0.26 }}
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                <Animated.View pointerEvents="none" style={[styles.glowBorder, { opacity: glow }]} />
                <View style={styles.content}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Playing Now</Text>
                        <View style={styles.dot} />
                    </View>
                    <View style={styles.stat}>
                        <Text style={styles.big}>{activeElapsed}</Text>
                        <Text style={styles.sublabel}>so far</Text>
                    </View>
                    {earned.length > 0 && <Text style={styles.recentLabel}>Earned ({earned.length})</Text>}
                    {earned.length > 0 ? (
                        <AchievementIconRow items={earned} apiHost={apiHost} />
                    ) : (
                        <Text style={styles.noData}>No achievements yet this session</Text>
                    )}
                </View>
            </View>
        )
    }

    const duration = last ? (() => {
        const mins = last.durationMin ?? 0
        return mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`
    })() : ''
    const earned = (last?.achievements ?? []).map(resolve)

    return (
        <View style={styles.card}>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
                {bgUri && <Image source={{ uri: bgUri }} style={[StyleSheet.absoluteFill, styles.dimArt]} contentFit="cover" />}
            </View>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.title}>Last Session</Text>
                    {last && <Text style={styles.dateChip}>{fmtDate(last.startedAt)}</Text>}
                </View>
                {!last ? (
                    <Text style={styles.noData}>No sessions recorded yet</Text>
                ) : (
                    <>
                        <View style={styles.stat}>
                            <Text style={styles.big}>{duration}</Text>
                            <Text style={styles.sublabel}>played</Text>
                        </View>
                        {earned.length > 0 && <Text style={styles.recentLabel}>Earned ({earned.length})</Text>}
                        {earned.length > 0 ? (
                            <AchievementIconRow items={earned} apiHost={apiHost} />
                        ) : (
                            <Text style={styles.noData}>No achievements this session</Text>
                        )}
                    </>
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, minHeight: 160, overflow: 'hidden' },
    // .gj-card--active-session — gold border + faint accent wash under the art scrim.
    activeCard: { borderColor: 'rgba(201,168,76,0.5)', backgroundColor: 'rgba(201,168,76,0.035)' },
    glowBorder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: 'rgba(201,168,76,0.7)', borderRadius: 8 },
    // .gj-card--game-bg::before — dim the last-session art to 0.18.
    dimArt: { opacity: 0.18 },
    content: { padding: spacing.md, gap: spacing.sm },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    dateChip: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    // .gj-active-dot — static gold dot (the border glow carries the motion).
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    stat: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
    big: { color: colors.text, fontFamily: fonts.title, fontSize: 24 },
    sublabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    recentLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase' },
})
