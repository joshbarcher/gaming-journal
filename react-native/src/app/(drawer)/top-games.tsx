import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { getFlags } from '@/api/flags'
import { getSettings } from '@/api/settings'
import { getTopGames, setTopGameFiltered } from '@/api/topGames'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { Sparkline } from '@/components/shared/Sparkline'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { makeShouldShow } from '@/utils/gameFilter'
import type { TopGameEntry } from 'gaming-journal-contracts/topGames'
import type { GameFlags } from 'gaming-journal-contracts/flags'

// Port of collections/top-games.md. Column visibility ported directly from top-games.css's own
// breakpoints (not invented): the web collapses to just rank/thumbnail/name/"Now" at ≤799px,
// hiding the muted peak stats, sparkline, and mute button entirely — so mobilePortrait and
// mobileLandscapeTabletPortrait both show the compact row here, and only tabletLandscape (800+)
// shows the full row. This is the same column-hiding decision as the web, not a new one.
//
// fmt() ported verbatim from TopGames.svelte (M/K/plain-integer/— formatting) as a local function
// — scoped to this screen since nothing else needs Steam-player-count-style number formatting yet
// (different from formatPlaytime, which formats minutes-as-hours for a different set of screens).
//
// **Real gap found and fixed by the Phase 6 gotcha cross-check pass**: `TopGames.svelte` filters
// `allEntries` through `loadGameFilter()`/`shouldShow()` (games marked software/childLock/filtered
// via Settings are removed) BEFORE the screen's own separate per-entry `filtered` mute toggle is
// ever applied — this screen was missing that first pass entirely. Added `getFlags`/`getSettings`
// + `makeShouldShow`, same as Library.
function fmt(n: number | null | undefined): string {
    if (n == null || n === 0) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

export default function TopGamesScreen() {
    const topGamesQuery = useQuery({
        queryKey: ['topGames'],
        queryFn: () => getTopGames(100),
        refetchInterval: 30 * 60 * 1000, // matches web's 30-min auto-refresh
    })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const showFullRow = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const [hideFiltered, setHideFiltered] = useState(false)
    const queryClient = useQueryClient()

    const filterMutation = useMutation({
        mutationFn: ({ appid, filtered }: { appid: number; filtered: boolean }) => setTopGameFiltered(appid, filtered),
        onSuccess: (_data, { appid, filtered }) => {
            queryClient.setQueryData<TopGameEntry[]>(['topGames'], (old) =>
                old?.map(e => (e.appid === appid ? { ...e, filtered } : e)),
            )
        },
    })

    const allEntries = useMemo(() => {
        if (!flagsQuery.data || !settingsQuery.data) return []
        const shouldShow = makeShouldShow(flagsQuery.data, settingsQuery.data)
        return (topGamesQuery.data ?? []).filter(e => shouldShow(e.appid))
    }, [topGamesQuery.data, flagsQuery.data, settingsQuery.data])
    const filteredCount = allEntries.filter(e => e.filtered).length

    // Muted games stay INTERLEAVED at their real rank (de-emphasized) when the filter is off, so the
    // list reads as the true top-N with some rows dimmed — not a separate appended "—" block. Turning
    // the filter on drops them and the survivors renumber so the ranks stay contiguous. (Web parity:
    // TopGames.svelte displayRows.)
    const displayRows = useMemo(() => {
        let rank = 0
        return allEntries
            .filter(e => !(hideFiltered && e.filtered))
            .map(e => ({ ...e, displayRank: String(++rank) }))
    }, [allEntries, hideFiltered])

    const apiHost = apiHostQuery.data

    if (topGamesQuery.isLoading || flagsQuery.isLoading || settingsQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading…</Text></View>
    }

    if (!allEntries.length) {
        return (
            <View style={styles.container}>
                <Text style={styles.emptyText}>
                    No data yet — trigger a collection first via POST /relay/api/player-counts/collect.
                </Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Steam</Text>
                <Text style={styles.title}>Top Games</Text>
                {filteredCount > 0 && (
                    <Pressable onPress={() => setHideFiltered(v => !v)} style={styles.hideFilteredBtn}>
                        <Text style={styles.hideFilteredText}>
                            {hideFiltered ? `Show ${filteredCount} filtered` : `Hide ${filteredCount} filtered`}
                        </Text>
                    </Pressable>
                )}
            </View>

            <FlatList
                data={displayRows}
                keyExtractor={(item) => String(item.appid)}
                renderItem={({ item }) => (
                    <TopGameRow
                        entry={item}
                        rank={item.displayRank}
                        apiHost={apiHost}
                        showFullRow={showFullRow}
                        flags={flagsQuery.data?.[item.appid]}
                        onToggleFilter={() => filterMutation.mutate({ appid: item.appid, filtered: !item.filtered })}
                    />
                )}
                // Perf pass: this is the single largest unpaginated list in the app (up to 100 real
                // rows, no windowing anywhere else in the screen) — tuned windowSize/batch size
                // rather than relying on FlatList's defaults, which are sized for shorter lists.
                initialNumToRender={20}
                maxToRenderPerBatch={10}
                windowSize={7}
                removeClippedSubviews
            />
        </View>
    )
}

function TopGameRow({
    entry, rank, apiHost, showFullRow, flags, onToggleFilter,
}: {
    entry: TopGameEntry
    rank: string
    apiHost: string | undefined
    showFullRow: boolean
    flags: GameFlags | undefined
    onToggleFilter: () => void
}) {
    // <Link asChild> requires a flattened style object, not an array — the recurring PLAN.md gotcha.
    const rowStyle = StyleSheet.flatten([styles.row, entry.filtered && styles.rowFiltered])

    return (
        <Link href={`/game/${entry.appid}` as never} asChild>
            <Pressable style={rowStyle} onLongPress={(e) => openGameCardMenu(entry.appid, flags, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}>
                <Text style={styles.rank}>{rank}</Text>
                {apiHost && (
                    <Image
                        source={{ uri: `${apiHost}/relay/images/steam/games/${entry.appid}/header.jpg` }}
                        style={styles.thumb}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={String(entry.appid)}
                    />
                )}
                <View style={styles.nameCell}>
                    <Text style={styles.name} numberOfLines={1}>{entry.name ?? `App ${entry.appid}`}</Text>
                    <View style={styles.badgeRow}>
                        {entry.owned && <Text style={styles.badge}>Owned</Text>}
                        {entry.wishlisted && <Text style={styles.badge}>Wishlisted</Text>}
                    </View>
                </View>
                <Text style={styles.stat}>{fmt(entry.latest)}</Text>
                {showFullRow && (
                    <>
                        <Text style={styles.statMuted}>{fmt(entry.peak24h)}</Text>
                        <Text style={styles.statMuted}>{fmt(entry.peak7d)}</Text>
                        <Text style={styles.statMuted}>{fmt(entry.peakAllTime)}</Text>
                        <Sparkline samples={entry.samples24h} />
                        <Pressable onPress={onToggleFilter} hitSlop={8} style={styles.muteBtn}>
                            <Text style={styles.muteBtnText}>{entry.filtered ? '⊕' : '⊘'}</Text>
                        </Pressable>
                    </>
                )}
            </Pressable>
        </Link>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    header: { padding: spacing.md, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    eyebrow: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase', width: '100%' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22, flex: 1 },
    hideFilteredBtn: { backgroundColor: colors.bgHover, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    hideFilteredText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 11 },
    row: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    rowFiltered: { opacity: 0.5 }, // de-emphasised but readable (web parity: .tg-row-wrap--muted)
    rank: { width: 24, color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 12, textAlign: 'center' },
    thumb: { width: 48, height: 22, borderRadius: 3, backgroundColor: colors.bgHover },
    nameCell: { flex: 1, gap: 2 },
    name: { color: colors.text, fontFamily: fonts.ui, fontSize: 13 },
    badgeRow: { flexDirection: 'row', gap: 4 },
    badge: { color: colors.progress, fontFamily: fonts.ui, fontSize: 9 },
    stat: { width: 56, color: colors.text, fontFamily: fonts.uiBold, fontSize: 12, textAlign: 'right' },
    statMuted: { width: 56, color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textAlign: 'right' },
    muteBtn: { paddingHorizontal: spacing.xs },
    muteBtnText: { color: colors.textMuted, fontSize: 16 },
})
