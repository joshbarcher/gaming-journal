import { Feather } from '@expo/vector-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Link } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native'
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist'

import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getHltbIndex } from '@/api/hltb'
import { getOrder, setOrder } from '@/api/order'
import { getSettings } from '@/api/settings'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useGridColumns } from '@/hooks/useGridColumns'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts, radius } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
import { makeShouldShow } from '@/utils/gameFilter'
import { computeHltbProgress } from '@/utils/hltbProgress'
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'
import type { HltbEntry } from 'gaming-journal-contracts/hltb'

// Faithful port of InProgress.svelte + public/css/in-progress.css — the web renders the queue as a
// 3-across "▶ Up Next" row of large landscape HERO cards (art on top, number badge top-left, hours
// badge top-right over the image, title, then a FULL-WIDTH progress bar beneath the art) followed by
// a dense multi-column "Queue · N more" grid of the same card in miniature. An earlier native pass
// collapsed both into a single-column list of horizontal thumb+text rows — a different design. This
// restores the web structure at the tablet-landscape/desktop tier.
//
// Layout: one vertical ScrollView. The trio is a fixed-width row; the remainder (index 3+) is a
// fixed-width flex-wrap grid whose column count comes from useGridColumns (mirroring the web
// `minmax(200px,1fr)` auto-fill). Fixed widths (not flex) keep the last partial row left-aligned at
// natural width, exactly like the web's auto-fill grid — flex weights would stretch it.
//
// Reorder: the web uses HTML5 drag across BOTH sections (one underlying ordered array). RN's
// draggable-flatlist can't do multi-column grid drag, so the trio is a HORIZONTAL DraggableFlatList
// (long-press a hero card, drag left/right) — a horizontal list inside a vertical scroll is the
// supported orientation. Reordering the trio persists the full order (trio + untouched grid tail).
// The grid tail is tap-to-open only; promoting a grid game into the trio is the pragmatic gap vs web.

// In-Progress page accent — the amber `--inprogress-accent` from in-progress.css, distinct from the
// app's global gold. Web keeps these page-scoped, so mirror them here rather than reusing tokens.
const ACCENT = '#e0a052'
const ACCENT_BD = 'rgba(224, 160, 82, 0.32)'
const GAP = 16

type InProgressItem = { appid: number; name: string; playtime: number; hltb?: HltbEntry }

function HeroCard({
    item,
    apiHost,
    index,
    showNumber,
    containerStyle,
    isActive,
    onLongPress,
}: {
    item: InProgressItem
    apiHost: string | undefined
    index: number
    showNumber: boolean
    containerStyle: ViewStyle
    isActive?: boolean
    onLongPress?: () => void
}) {
    const progress = computeHltbProgress(item.playtime, item.hltb)
    const played = item.playtime > 0 ? formatPlaytime(item.playtime) : null

    // `Link asChild` clones its child and merges its own style — it throws on an array of styles, so
    // flatten to a single object (same gotcha documented on the Library screen).
    const cardStyle = StyleSheet.flatten([
        styles.card,
        showNumber && styles.cardUpNext,
        isActive && styles.cardActive,
        containerStyle,
    ])

    return (
        <Link href={`/game/${item.appid}` as never} asChild>
            <Pressable style={cardStyle} onLongPress={onLongPress}>
                <View style={styles.imgWrap}>
                    {apiHost && (
                        <Image
                            source={{ uri: `${apiHost}/relay/images/steam/games/${item.appid}/header.jpg` }}
                            style={styles.img}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={String(item.appid)}
                        />
                    )}
                    <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.55)']}
                        locations={[0.5, 1]}
                        style={StyleSheet.absoluteFill}
                    />
                    {showNumber && (
                        <View style={styles.numBadge}>
                            <Text style={styles.numText}>{index + 1}</Text>
                        </View>
                    )}
                    {played && (
                        <View style={styles.timeBadge}>
                            <Text style={styles.timeText}>{played}</Text>
                        </View>
                    )}
                </View>
                <View style={styles.body}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    {progress?.label && <Text style={styles.progressLabel}>{progress.label}</Text>}
                </View>
                {progress && (
                    <View style={styles.barWrap}>
                        <View style={styles.barTrack}>
                            <LinearGradient
                                colors={['#c9913d', '#e8b870']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={[styles.barFill, { width: `${progress.fillPct}%` }]}
                            />
                            {progress.ticks.map((tick, i) => (
                                <View key={i} style={[styles.barTick, { left: `${tick.pct}%` }]} />
                            ))}
                        </View>
                    </View>
                )}
            </Pressable>
        </Link>
    )
}

export default function InProgressScreen({ embedded = false }: { embedded?: boolean }) {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const hltbQuery = useQuery({ queryKey: ['hltbIndex'], queryFn: getHltbIndex })
    const orderQuery = useQuery({ queryKey: ['order', 'in-progress'], queryFn: () => getOrder('in-progress') })
    const apiHostQuery = useApiHost()
    const queryClient = useQueryClient()
    const [localOrder, setLocalOrder] = useState<number[] | null>(null)

    // Content width (window − permanent rail − page padding) drives both the trio card width and the
    // grid card width — horizontal lists can't flex their items, and fixed grid widths avoid a
    // stretched last row. Same rail math as useGridColumns so the two sections share one left edge.
    const { width } = useWindowDimensions()
    const breakpoint = useBreakpoint()
    const collapsed = useSidebarStore(s => s.collapsed)
    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const rail = isPermanentRail ? (collapsed ? 68 : 280) : 0
    const PAGE_PAD = isPermanentRail ? 40 : breakpoint === 'mobileLandscapeTabletPortrait' ? 24 : 16
    const contentWidth = Math.max(1, width - rail - PAGE_PAD * 2)
    const trioCardW = Math.floor((contentWidth - GAP * 2) / 3)
    const numColumns = useGridColumns(200, { gap: GAP, horizontalPadding: PAGE_PAD * 2 })
    const gridCardW = Math.floor((contentWidth - GAP * (numColumns - 1)) / numColumns)

    const orderMutation = useMutation({
        mutationFn: (appids: number[]) => setOrder('in-progress', appids),
        onSuccess: (data) => queryClient.setQueryData(['order', 'in-progress'], data),
    })

    const items: InProgressItem[] = useMemo(() => {
        const flags = flagsQuery.data
        const games = gamesQuery.data
        const hltbList = hltbQuery.data
        const savedOrder = localOrder ?? orderQuery.data
        if (!flags || !games || !hltbList || !savedOrder) return []

        const gameMap = new Map(games.map(g => [g.appid, g]))
        const hltbMap = new Map(hltbList.map(h => [h.appid, h]))
        const shouldShow = makeShouldShow(flags, settingsQuery.data ?? {})
        const ids = Object.entries(flags)
            .filter(([id, f]) => f.inProgress && shouldShow(id))
            .map(([id]) => Number(id))

        const toItem = (appid: number): InProgressItem => {
            const g: SteamGameRaw | undefined = gameMap.get(appid)
            return { appid, name: g?.name ?? `App ${appid}`, playtime: g?.playtime_forever ?? 0, hltb: hltbMap.get(appid) }
        }

        const sortedByName = ids.map(toItem).sort((a, b) => a.name.localeCompare(b.name))
        const seen = new Set<number>()
        const ordered: InProgressItem[] = []
        for (const appid of savedOrder) {
            const item = sortedByName.find(i => i.appid === appid)
            if (item) { ordered.push(item); seen.add(appid) }
        }
        for (const item of sortedByName) { if (!seen.has(item.appid)) ordered.push(item) }
        return ordered
    }, [flagsQuery.data, settingsQuery.data, gamesQuery.data, hltbQuery.data, orderQuery.data, localOrder])

    const totalMins = items.reduce((s, i) => s + i.playtime, 0)
    const subtitle = totalMins > 0
        ? `${formatPlaytime(totalMins)} invested across ${items.length} paused game${items.length !== 1 ? 's' : ''}`
        : `${items.length} game${items.length !== 1 ? 's' : ''} paused`

    const apiHost = apiHostQuery.data
    const isLoading = flagsQuery.isLoading || settingsQuery.isLoading || gamesQuery.isLoading || hltbQuery.isLoading || orderQuery.isLoading

    const queueItems = items.slice(0, 3)
    const restItems = items.slice(3)

    // Reordering the trio permutes only the first ≤3 ids; persist the full order (new trio + the
    // untouched grid tail) so the server sees the complete sequence.
    function handleTrioReorder(newTrio: InProgressItem[]) {
        const appids = [...newTrio, ...restItems].map(i => i.appid)
        setLocalOrder(appids)
        orderMutation.mutate(appids)
    }

    if (isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading…</Text></View>
    }

    if (!items.length) {
        return (
            <View style={styles.container}>
                <Text style={styles.emptyText}>
                    No games in progress. Open any game page and toggle the In Progress flag to add it here.
                </Text>
            </View>
        )
    }

    const renderTrioItem = ({ item, drag, isActive, getIndex }: RenderItemParams<InProgressItem>) => (
        <HeroCard
            item={item}
            apiHost={apiHost}
            index={getIndex() ?? 0}
            showNumber
            containerStyle={{ width: trioCardW }}
            isActive={isActive}
            onLongPress={drag}
        />
    )

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
            {embedded ? (
                <Text style={[styles.metaLine, { paddingHorizontal: PAGE_PAD }]}>{subtitle}</Text>
            ) : (
                <View style={[styles.header, { paddingHorizontal: PAGE_PAD }]}>
                    <Text style={styles.eyebrow}>Collection</Text>
                    <Text style={styles.title}>In Progress</Text>
                    <Text style={styles.subtitle}>{subtitle}</Text>
                </View>
            )}

            <View style={[styles.queueSection, { paddingHorizontal: PAGE_PAD }]}>
                <View style={styles.queueHeader}>
                    <Feather name="play" size={12} color={ACCENT} />
                    <Text style={styles.queueLabel}>Up Next</Text>
                    <Text style={styles.queueHint}>Drag to reorder</Text>
                </View>
                <DraggableFlatList
                    horizontal
                    data={queueItems}
                    keyExtractor={(item) => String(item.appid)}
                    onDragEnd={({ data }) => handleTrioReorder(data)}
                    renderItem={renderTrioItem}
                    ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
                    scrollEnabled={false}
                    showsHorizontalScrollIndicator={false}
                />
            </View>

            {restItems.length > 0 && (
                <>
                    <View style={[styles.restSep, { paddingHorizontal: PAGE_PAD }]}>
                        <View style={styles.restSepLine} />
                        <Text style={styles.restSepLabel}>Queue · {restItems.length} more</Text>
                        <View style={styles.restSepLine} />
                    </View>
                    <View style={[styles.grid, { paddingHorizontal: PAGE_PAD }]}>
                        {restItems.map((item, i) => (
                            <HeroCard
                                key={item.appid}
                                item={item}
                                apiHost={apiHost}
                                index={i + 3}
                                showNumber={false}
                                containerStyle={{ width: gridCardW }}
                            />
                        ))}
                    </View>
                </>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    scrollContent: { paddingBottom: 48 },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: 16 },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: 40, textAlign: 'center' },

    header: { paddingTop: 24, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 24 },
    metaLine: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, paddingTop: 16, paddingBottom: 18 },
    eyebrow: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 30, letterSpacing: 0.5 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, marginTop: 6 },

    queueSection: { paddingBottom: 24 },
    queueHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    queueLabel: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
    queueHint: { marginLeft: 'auto', color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },

    restSep: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
    restSepLine: { flex: 1, height: 1, backgroundColor: colors.border },
    restSepLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },

    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden',
    },
    cardUpNext: { borderColor: ACCENT_BD },
    cardActive: { borderColor: ACCENT, opacity: 0.9 },

    imgWrap: { width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    img: { width: '100%', height: '100%' },
    numBadge: {
        position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 11,
        backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', zIndex: 2,
    },
    numText: { color: '#1a1208', fontFamily: fonts.uiBold, fontSize: 11 },
    timeBadge: {
        position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(10,10,14,0.75)',
        borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: ACCENT_BD,
    },
    timeText: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.3 },

    body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 4 },
    name: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13, lineHeight: 17 },
    progressLabel: { color: ACCENT, fontFamily: fonts.ui, fontSize: 11 },

    barWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgRaised },
    barTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', position: 'relative' },
    barFill: { height: '100%', borderRadius: 3 },
    barTick: { position: 'absolute', top: -2, width: 1.5, height: 9, marginLeft: -0.75, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
})
