import { Feather } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Link } from 'expo-router'
import { useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getLastPlayedMap } from '@/api/playtime'
import { getSettings } from '@/api/settings'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useGridColumns } from '@/hooks/useGridColumns'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { makeShouldShow } from '@/utils/gameFilter'
import type { GameFlags } from 'gaming-journal-contracts/flags'

// Port of History.svelte (activity/history). The web merges the relay's effective-playtime
// last-played map with the owned-games list, content-filters via shouldShow(), sorts by recency,
// then features the top-3 in a "Recently Played" row above an "Earlier · N more" grid. Browser-only
// concerns (keyboard arrow-nav, scroll-position persistence) are dropped for touch idioms.
//
// The web history page carries its own blue identity (--history-accent: #7eb8d4) for the eyebrow,
// the "Recently Played" label and its clock glyph — kept here as a local constant rather than a
// shared token change, so history reads the same on native without touching the global palette.
const HISTORY_ACCENT = '#7eb8d4'

type HistoryEntry = { appid: number; name: string; playtime: number; lastPlayedAt: string }

// Ported verbatim from History.svelte's fmtHours — deliberately NOT formatPlaytime(), which rounds
// differently; parity with the web label ("3.4h played") matters here.
function fmtHours(mins: number): string | null {
    if (!mins) return null
    const h = mins / 60
    if (h < 1) return `${Math.round(mins)}m`
    if (h < 10) return `${h.toFixed(1)}h`
    return `${Math.round(h)}h`
}

function fmtRelative(isoStr: string | null | undefined): string | null {
    if (!isoStr) return null
    const diffMs = Date.now() - new Date(isoStr).getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 2) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `${diffD}d ago`
    if (diffD < 31) return `${Math.floor(diffD / 7)}w ago`
    return new Date(isoStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HistoryScreen() {
    const lastPlayedQuery = useQuery({ queryKey: ['lastPlayedMap'], queryFn: getLastPlayedMap })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const apiHost = useApiHost().data
    const breakpoint = useBreakpoint()
    // Web `.history-grid` (the "Earlier" games grid) = repeat(auto-fill, minmax(160px,1fr)); mirror
    // that so a desktop-tier tablet fans the earlier row out fluidly. min:2 mirrors the web's phone-
    // portrait `repeat(2,1fr)` floor (and keeps the unconditional columnWrapperStyle valid). The
    // featured top-3 row is a separate flex layout that still stacks only on phone, so `stackFeatured`
    // keeps its breakpoint.
    const numColumns = useGridColumns(160, { min: 2 })
    const stackFeatured = breakpoint === 'mobilePortrait'

    const games: HistoryEntry[] = useMemo(() => {
        const lastPlayed = lastPlayedQuery.data
        const owned = gamesQuery.data
        if (!lastPlayed || !owned) return []
        const gameMap = new Map(owned.map(g => [g.appid, g]))
        const shouldShow = makeShouldShow(flagsQuery.data ?? {}, settingsQuery.data ?? {})
        return Object.entries(lastPlayed)
            .map(([appidStr, data]): HistoryEntry => {
                const appid = Number(appidStr)
                return {
                    appid,
                    name: gameMap.get(appid)?.name ?? `App ${appid}`,
                    playtime: data.effectiveMin ?? 0,
                    lastPlayedAt: data.lastPlayedAt ?? '',
                }
            })
            .filter(g => g.lastPlayedAt && shouldShow(g.appid))
            .sort((a, b) => new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime())
    }, [lastPlayedQuery.data, gamesQuery.data, flagsQuery.data, settingsQuery.data])

    const isLoading = lastPlayedQuery.isLoading || gamesQuery.isLoading || flagsQuery.isLoading || settingsQuery.isLoading
    const error = lastPlayedQuery.error || gamesQuery.error

    if (isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading…</Text></View>
    }
    if (error) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>Failed to load history: {(error as Error).message}</Text>
            </View>
        )
    }

    const topGames = games.slice(0, 3)
    const restGames = games.slice(3)
    const subtitle = games.length
        ? `${games.length} game${games.length !== 1 ? 's' : ''} · last played ${fmtRelative(games[0].lastPlayedAt) ?? '—'}`
        : ''

    const header = (
        <View>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Activity</Text>
                <Text style={styles.title}>History</Text>
                {games.length > 0 && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>

            {games.length === 0 ? (
                <Text style={styles.emptyText}>No play history recorded yet.</Text>
            ) : (
                <>
                    <View style={styles.recentHeader}>
                        <Feather name="clock" size={13} color={HISTORY_ACCENT} />
                        <Text style={styles.recentLabel}>Recently Played</Text>
                    </View>
                    <View style={[styles.recentRow, stackFeatured && styles.recentRowStacked]}>
                        {topGames.map((g, i) => (
                            <View key={g.appid} style={stackFeatured ? styles.featuredCellStacked : styles.featuredCell}>
                                <HistoryCard game={g} rank={i + 1} apiHost={apiHost} flags={flagsQuery.data?.[g.appid]} featured />
                            </View>
                        ))}
                    </View>

                    {restGames.length > 0 && (
                        <View style={styles.restSep}>
                            <View style={styles.restSepLine} />
                            <Text style={styles.restSepLabel}>Earlier · {restGames.length} more</Text>
                            <View style={styles.restSepLine} />
                        </View>
                    )}
                </>
            )}
        </View>
    )

    return (
        <View style={styles.container}>
            <FlatList
                key={numColumns}
                data={restGames}
                numColumns={numColumns}
                keyExtractor={(item) => String(item.appid)}
                ListHeaderComponent={header}
                contentContainerStyle={styles.listContent}
                columnWrapperStyle={styles.gridRow}
                initialNumToRender={12}
                windowSize={7}
                removeClippedSubviews
                renderItem={({ item, index }) => (
                    <View style={{ flex: 1 / numColumns }}>
                        <HistoryCard game={item} rank={index + 4} apiHost={apiHost} flags={flagsQuery.data?.[item.appid]} />
                    </View>
                )}
            />
        </View>
    )
}

function HistoryCard({ game, rank, apiHost, flags, featured }: { game: HistoryEntry; rank: number; apiHost: string | undefined; flags: GameFlags | undefined; featured?: boolean }) {
    const relLabel = fmtRelative(game.lastPlayedAt)
    const ptLabel = fmtHours(game.playtime)
    return (
        <Link href={`/game/${game.appid}` as never} asChild>
            <Pressable
                style={styles.card}
                onLongPress={(e) => openGameCardMenu(game.appid, flags, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            >
                <View style={[styles.cardImgWrap, featured && styles.cardImgWrapFeatured]}>
                    {apiHost && (
                        <Image
                            source={{ uri: `${apiHost}/relay/images/steam/games/${game.appid}/header.jpg` }}
                            style={styles.cardImg}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={String(game.appid)}
                        />
                    )}
                    {/* Bottom-anchored scrim only, ported from `.history-card-overlay`
                        (linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)). The previous
                        solid `rgba(0,0,0,0.42)` block over the bottom 55% produced a hard-edged flat
                        dimming across the middle of the art; a gradient over the full wrap darkens only
                        the bottom sliver behind the number/time badges, matching web. */}
                    <LinearGradient
                        colors={['transparent', 'transparent', 'rgba(0,0,0,0.65)']}
                        locations={[0, 0.45, 1]}
                        style={styles.cardOverlay}
                        pointerEvents="none"
                    />
                    <View style={[styles.cardNum, featured && styles.cardNumFeatured]}>
                        <Text style={[styles.cardNumText, featured && styles.cardNumTextFeatured]}>{rank}</Text>
                    </View>
                    {relLabel && (
                        <View style={styles.cardTimeWrap}>
                            <Text style={styles.cardTime}>{relLabel}</Text>
                        </View>
                    )}
                </View>
                <View style={styles.cardBody}>
                    <Text style={[styles.cardName, featured && styles.cardNameFeatured]} numberOfLines={1}>{game.name}</Text>
                    {ptLabel && <Text style={styles.cardPlayed}>{ptLabel} played</Text>}
                </View>
            </Pressable>
        </Link>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    errorText: { color: colors.accent2, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },

    header: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 4 },
    eyebrow: { color: HISTORY_ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 26 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, marginTop: 2 },

    recentHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    recentLabel: { color: HISTORY_ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
    recentRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    recentRowStacked: { flexDirection: 'column' },
    featuredCell: { flex: 1 },
    featuredCellStacked: { width: '100%' },

    restSep: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    restSepLine: { flex: 1, height: 1, backgroundColor: colors.border },
    restSepLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },

    gridRow: { gap: spacing.sm },
    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden', marginBottom: spacing.sm,
    },
    cardImgWrap: { position: 'relative', width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    cardImgWrapFeatured: { aspectRatio: 16 / 7 },
    cardImg: { width: '100%', height: '100%' },
    cardOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    cardNum: {
        position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 11,
        backgroundColor: 'rgba(0,0,0,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
        alignItems: 'center', justifyContent: 'center',
    },
    cardNumFeatured: { top: 10, left: 10, width: 26, height: 26, borderRadius: 13 },
    cardNumText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 10 },
    cardNumTextFeatured: { fontSize: 12 },
    cardTimeWrap: {
        position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)',
        borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    },
    cardTime: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.uiBold, fontSize: 10 },
    cardBody: { paddingHorizontal: 11, paddingTop: 8, paddingBottom: 9, gap: 3 },
    cardName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    cardNameFeatured: { fontSize: 13 },
    cardPlayed: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10.5 },
})
