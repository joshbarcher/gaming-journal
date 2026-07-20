import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'

import { getGameDetail } from '@/api/gamePage'
import { getGameAchievements } from '@/api/journal'
import { getNowPlaying } from '@/api/sidebar'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useGridColumns } from '@/hooks/useGridColumns'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { cleanAchName, fmtDate, mergeSessionAchievements } from '@/utils/journalRender'
import type { AchievementItem } from 'gaming-journal-contracts/achievements'

// web `.gj-ach-grid`: repeat(auto-fill, minmax(260px, 1fr)), gap 10px. Mirrored via useGridColumns.
const ACH_MIN = 260
const ACH_GAP = 10
const PAGE_PAD = spacing.md

// Port of JournalAchievements.svelte (rendered at /journal/{appid}/achievements on the web). The
// list comes from the same endpoint the hub's Achievement card already uses —
// `getGameAchievements(appid)` → GET /relay/api/steam/achievements/{appid} — so no new fetch helper
// is added. Like the web onMount, it also reads now-playing and merges any achievements unlocked
// during a live session for this game (mergeSessionAchievements), so a just-earned achievement
// shows as unlocked without waiting for Steam to persist it.
//
// Browser-only bits dropped for touch: the web truncates name/description to one line each and
// reveals the full text via a floating hover tooltip (gj-tooltip). There is no hover on touch, so
// the full name and description are shown inline (wrapped) instead — the documented
// hover-tooltip simplification already used across this port. There is no per-achievement rarity
// percentage in the achievements contract (nor does the web render one), so "unlock %" is surfaced
// as the overall unlocked/total percentage in the summary header — the only place a % is meaningful
// given the available data.
export default function JournalAchievementsScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const apiHost = useApiHost().data

    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const achQuery = useQuery({ queryKey: ['gameAchievements', appid], queryFn: () => getGameAchievements(appid) })
    const nowPlayingQuery = useQuery({ queryKey: ['nowPlaying'], queryFn: getNowPlaying })

    // Rail-aware fluid card grid (web `.gj-ach-grid` = auto-fill minmax(260px,1fr), gap 10).
    const { width } = useWindowDimensions()
    const breakpoint = useBreakpoint()
    const collapsed = useSidebarStore(s => s.collapsed)
    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const rail = isPermanentRail ? (collapsed ? 68 : 280) : 0
    const contentWidth = Math.max(1, width - rail - PAGE_PAD * 2)
    const numColumns = useGridColumns(ACH_MIN, { gap: ACH_GAP, horizontalPadding: PAGE_PAD * 2 })
    const cardWidth = Math.floor((contentWidth - ACH_GAP * (numColumns - 1)) / numColumns)

    const [showHidden, setShowHidden] = useState(false)

    const activeSession = nowPlayingQuery.data?.playing?.appid === appid ? nowPlayingQuery.data.playing : null

    const achList = useMemo(
        () => mergeSessionAchievements(achQuery.data ?? [], activeSession?.achievementsDuring),
        [achQuery.data, activeSession?.achievementsDuring],
    )

    const unlocked = useMemo(
        () => [...achList].filter(a => a.achieved).sort((a, b) => (b.unlocktime ?? 0) - (a.unlocktime ?? 0)),
        [achList],
    )
    const lockedVis = useMemo(() => achList.filter(a => !a.achieved && !a.hidden), [achList])
    const lockedHidden = useMemo(() => achList.filter(a => !a.achieved && a.hidden), [achList])

    const total = achList.length
    const pct = total > 0 ? Math.round((unlocked.length / total) * 100) : 0

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.header}>
                <Pressable onPress={() => router.push(`/journal/${appid}` as never)}>
                    <Text style={styles.breadcrumb}>
                        Home / {gameQuery.data?.name ?? '…'} / Journal / <Text style={styles.breadcrumbCurrent}>Achievements</Text>
                    </Text>
                </Pressable>
                {lockedHidden.length > 0 && (
                    <Pressable style={styles.toggle} onPress={() => setShowHidden(v => !v)} hitSlop={6}>
                        <View style={[styles.checkbox, showHidden && styles.checkboxOn]}>
                            {showHidden && <Text style={styles.checkboxMark}>✓</Text>}
                        </View>
                        <Text style={styles.toggleLabel}>Show hidden ({lockedHidden.length})</Text>
                    </Pressable>
                )}
            </View>

            {achQuery.isLoading ? (
                <Text style={styles.stateText}>Loading…</Text>
            ) : achQuery.isError ? (
                <Text style={styles.stateText}>Failed to load achievements.</Text>
            ) : total === 0 ? (
                <Text style={styles.stateText}>No achievement data available.</Text>
            ) : (
                <>
                    <View style={styles.summary}>
                        <View style={styles.summaryLine}>
                            <Text style={styles.summaryText}>{unlocked.length} / {total} unlocked</Text>
                            <Text style={styles.summaryPct}>{pct}%</Text>
                        </View>
                        <View style={styles.track}>
                            <View style={[styles.fill, { width: `${pct}%` }]} />
                        </View>
                    </View>

                    {unlocked.length > 0 && (
                        <Section label={`Unlocked (${unlocked.length})`}>
                            {unlocked.map(a => (
                                <AchievementFullItem key={a.apiname} a={a} isUnlocked isHidden={false} apiHost={apiHost} width={cardWidth} />
                            ))}
                        </Section>
                    )}

                    {lockedVis.length > 0 && (
                        <Section label={`Locked (${lockedVis.length})`}>
                            {lockedVis.map(a => (
                                <AchievementFullItem key={a.apiname} a={a} isUnlocked={false} isHidden={false} apiHost={apiHost} width={cardWidth} />
                            ))}
                        </Section>
                    )}

                    {showHidden && lockedHidden.length > 0 && (
                        <Section label={`Hidden (${lockedHidden.length})`}>
                            {lockedHidden.map(a => (
                                <AchievementFullItem key={a.apiname} a={a} isUnlocked={false} isHidden apiHost={apiHost} width={cardWidth} />
                            ))}
                        </Section>
                    )}
                </>
            )}
        </ScrollView>
    )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionLabel}>{label}</Text>
            <View style={styles.grid}>{children}</View>
        </View>
    )
}

// Mirrors AchievementItem.svelte's icon resolution: prefer the relay-hosted local icon (needs the
// apiHost prefix, like every other relay-relative image path), fall back to the absolute Steam CDN
// icon, then to a letter badge if both fail to load. Unlocked/locked pick the color vs. grayscale
// variant. Hidden (and still-locked) achievements suppress the description, matching the web.
function AchievementFullItem({
    a, isUnlocked, isHidden, apiHost, width,
}: { a: AchievementItem; isUnlocked: boolean; isHidden: boolean; apiHost: string | undefined; width: number }) {
    const name = a.displayName ?? cleanAchName(a.apiname)
    const localSrc = isUnlocked ? a.localIcon : a.localIconGray
    const localPrefixed = localSrc && apiHost ? `${apiHost}${localSrc}` : null
    const cdnFallback = isUnlocked ? a.icon : (a.icongray ?? a.icon)
    const candidates = [localPrefixed, cdnFallback].filter((s): s is string => !!s)

    const [idx, setIdx] = useState(0)
    const src = candidates[idx]
    const letter = name[0]?.toUpperCase() ?? '?'
    const desc = !isHidden ? (a.description ?? '') : ''
    const date = isUnlocked && a.unlocktime ? fmtDate(new Date(a.unlocktime * 1000)) : ''

    return (
        <View style={[styles.item, { width }, isUnlocked && styles.itemUnlocked]}>
            {src ? (
                <Image
                    source={{ uri: src }}
                    style={styles.badgeImg}
                    contentFit="cover"
                    onError={() => setIdx(i => i + 1)}
                />
            ) : (
                <View style={[styles.badgeLetter, isUnlocked ? styles.badgeLetterUnlocked : styles.badgeLetterLocked]}>
                    <Text style={[styles.badgeLetterText, isUnlocked && styles.badgeLetterTextUnlocked]}>{letter}</Text>
                </View>
            )}
            <View style={styles.info}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                {!!desc && <Text style={styles.desc} numberOfLines={2}>{desc}</Text>}
                {!!date && <Text style={styles.date}>{date}</Text>}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 12 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },

    toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    checkbox: { width: 16, height: 16, borderRadius: radius, borderWidth: 1, borderColor: colors.borderHi, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { backgroundColor: colors.accentBg, borderColor: colors.borderAct },
    checkboxMark: { color: colors.accent, fontSize: 11, lineHeight: 13, fontFamily: fonts.uiBold },
    toggleLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },

    stateText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, padding: spacing.lg, textAlign: 'center' },

    summary: { gap: spacing.xs, marginBottom: spacing.sm },
    summaryLine: { flexDirection: 'row', justifyContent: 'space-between' },
    summaryText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    summaryPct: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    track: { height: 6, backgroundColor: colors.bgHover, borderRadius: 3, overflow: 'hidden' },
    fill: { height: '100%', backgroundColor: colors.accent },

    section: { marginTop: spacing.md },
    sectionLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: ACH_GAP },

    // Fixed card width (set inline per card) — NOT flex:1 — so the last partial row stays left-aligned
    // like web's `auto-fill`. Icon fills the card height (align-items:stretch) at 80px wide, like web.
    item: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: 'hidden' },
    itemUnlocked: { borderColor: 'rgba(201,168,76,0.2)', backgroundColor: 'rgba(201,168,76,0.04)' },
    badgeImg: { width: 80, alignSelf: 'stretch', minHeight: 72 },
    badgeLetter: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', margin: 12, borderWidth: 1 },
    badgeLetterUnlocked: { backgroundColor: 'rgba(201,168,76,0.2)', borderColor: 'rgba(201,168,76,0.35)' },
    badgeLetterLocked: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)' },
    badgeLetterText: { fontFamily: fonts.uiBold, fontSize: 13, color: colors.textMuted },
    badgeLetterTextUnlocked: { color: colors.accent },
    info: { flex: 1, minWidth: 0, justifyContent: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    name: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    desc: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 3, lineHeight: 17 },
    date: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
})
