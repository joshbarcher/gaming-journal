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
import { useHomeData } from '@/hooks/useHomeData'
import { useNowPlaying } from '@/hooks/useNowPlaying'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts, radius } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
import { makeShouldShow } from '@/utils/gameFilter'
import { computeHltbProgress } from '@/utils/hltbProgress'
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'
import type { HltbEntry } from 'gaming-journal-contracts/hltb'

// Parity port of Playing.svelte + public/css/playing.css. The play list is an independent queue (its
// own `playlist` flag) surfaced as: an emphasized CURRENT card (the live now-playing session, or the
// last session as a fallback — separate from the list), then a 3-across "▶ Up Next" trio of large
// hero cards, then a dense "Queue · N more" grid. Every list card is numbered CONTINUOUSLY (trio 1-3,
// grid 4+). Structurally identical to in-progress.tsx, with a green play-list accent and the Current
// card on top. Reorder is the same horizontal-DraggableFlatList-on-the-trio approach (RN's list can't
// grid-drag); the grid tail is tap-only.

// Play-list accent — mirrors playing.css's `--playing-accent` (#46b98a), distinct from the app gold.
const ACCENT = '#46b98a'
const ACCENT_BD = 'rgba(70, 185, 138, 0.32)'
const GAP = 16

type PlayingItem = { appid: number; name: string; playtime: number; hltb?: HltbEntry }

function fmtElapsed(startIso: string | undefined): string | null {
    if (!startIso) return null
    const min = Math.max(1, Math.floor((Date.now() - new Date(startIso).getTime()) / 60_000))
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

function HeroCard({
    item, apiHost, index, containerStyle, isActive, onLongPress,
}: {
    item: PlayingItem
    apiHost: string | undefined
    index: number
    containerStyle: ViewStyle
    isActive?: boolean
    onLongPress?: () => void
}) {
    const progress = computeHltbProgress(item.playtime, item.hltb)
    const played = item.playtime > 0 ? formatPlaytime(item.playtime) : null

    // `Link asChild` clones its child and merges style — it throws on an array of styles, so flatten.
    const cardStyle = StyleSheet.flatten([styles.card, isActive && styles.cardActive, containerStyle])

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
                    <View style={styles.numBadge}>
                        <Text style={styles.numText}>{index + 1}</Text>
                    </View>
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
                                colors={['#2f9c72', '#63d6a4']}
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

function CurrentCard({ appid, name, live, elapsed, apiHost }: {
    appid: number
    name: string
    live: boolean
    elapsed: string | null
    apiHost: string | undefined
}) {
    const cardStyle = StyleSheet.flatten([styles.current, live && styles.currentLive])
    return (
        <Link href={`/game/${appid}` as never} asChild>
            <Pressable style={cardStyle}>
                {apiHost && (
                    <Image
                        source={{ uri: `${apiHost}/relay/images/steam/games/${appid}/header.jpg` }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                    />
                )}
                <LinearGradient
                    colors={['rgba(8,10,9,0.15)', 'rgba(8,10,9,0.55)', 'rgba(8,10,9,0.94)']}
                    style={StyleSheet.absoluteFill}
                />
                <View style={styles.currentBody}>
                    <View style={styles.currentEyebrowRow}>
                        {live && <View style={styles.currentDot} />}
                        <Text style={styles.currentEyebrow}>{live ? 'Now Playing' : 'Last Session'}</Text>
                    </View>
                    <Text style={styles.currentTitle} numberOfLines={2}>{name}</Text>
                    {live && elapsed && <Text style={styles.currentTime}>{elapsed}</Text>}
                </View>
            </Pressable>
        </Link>
    )
}

export default function PlayingScreen() {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const hltbQuery = useQuery({ queryKey: ['hltbIndex'], queryFn: getHltbIndex })
    const orderQuery = useQuery({ queryKey: ['order', 'playlist'], queryFn: () => getOrder('playlist') })
    const nowPlayingQuery = useNowPlaying()
    const homeQuery = useHomeData()
    const apiHostQuery = useApiHost()
    const queryClient = useQueryClient()
    const [localOrder, setLocalOrder] = useState<number[] | null>(null)

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
        mutationFn: (appids: number[]) => setOrder('playlist', appids),
        onSuccess: (data) => queryClient.setQueryData(['order', 'playlist'], data),
    })

    const items: PlayingItem[] = useMemo(() => {
        const flags = flagsQuery.data
        const games = gamesQuery.data
        const hltbList = hltbQuery.data
        const savedOrder = localOrder ?? orderQuery.data
        if (!flags || !games || !hltbList || !savedOrder) return []

        const gameMap = new Map(games.map(g => [g.appid, g]))
        const hltbMap = new Map(hltbList.map(h => [h.appid, h]))
        const shouldShow = makeShouldShow(flags, settingsQuery.data ?? {})
        const ids = Object.entries(flags)
            .filter(([id, f]) => f.playlist && shouldShow(id))
            .map(([id]) => Number(id))

        const toItem = (appid: number): PlayingItem => {
            const g: SteamGameRaw | undefined = gameMap.get(appid)
            return { appid, name: g?.name ?? `App ${appid}`, playtime: g?.playtime_forever ?? 0, hltb: hltbMap.get(appid) }
        }

        const sortedByName = ids.map(toItem).sort((a, b) => a.name.localeCompare(b.name))
        const seen = new Set<number>()
        const ordered: PlayingItem[] = []
        for (const appid of savedOrder) {
            const item = sortedByName.find(i => i.appid === appid)
            if (item) { ordered.push(item); seen.add(appid) }
        }
        for (const item of sortedByName) { if (!seen.has(item.appid)) ordered.push(item) }
        return ordered
    }, [flagsQuery.data, settingsQuery.data, gamesQuery.data, hltbQuery.data, orderQuery.data, localOrder])

    const subtitle = items.length
        ? `${items.length} game${items.length !== 1 ? 's' : ''} queued up to play`
        : 'Your play list is empty'

    const apiHost = apiHostQuery.data
    const isListLoading = flagsQuery.isLoading || settingsQuery.isLoading || gamesQuery.isLoading || hltbQuery.isLoading || orderQuery.isLoading

    const queueItems = items.slice(0, 3)
    const restItems = items.slice(3)

    // Current = the live session, else the last session (Home's `resume`), mirroring DrawerContent's
    // NowPlayingCard fallback. Separate from the play list.
    const playing = nowPlayingQuery.data?.playing
    const resume = homeQuery.data?.resume
    const currentAppid = playing?.appid ?? resume?.appid
    const currentLive = !!playing
    const currentName = playing?.name ?? resume?.name ?? (currentAppid != null ? `App ${currentAppid}` : '')
    const currentElapsed = currentLive ? fmtElapsed(playing?.sessionStartedAt) : null

    function handleTrioReorder(newTrio: PlayingItem[]) {
        const appids = [...newTrio, ...restItems].map(i => i.appid)
        setLocalOrder(appids)
        orderMutation.mutate(appids)
    }

    const renderTrioItem = ({ item, drag, isActive, getIndex }: RenderItemParams<PlayingItem>) => (
        <HeroCard
            item={item}
            apiHost={apiHost}
            index={getIndex() ?? 0}
            containerStyle={{ width: trioCardW }}
            isActive={isActive}
            onLongPress={drag}
        />
    )

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
            <View style={[styles.header, { paddingHorizontal: PAGE_PAD }]}>
                <Text style={styles.eyebrow}>Play List</Text>
                <Text style={styles.title}>Playing</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            {currentAppid != null && (
                <View style={[styles.currentSection, { paddingHorizontal: PAGE_PAD }]}>
                    <CurrentCard appid={currentAppid} name={currentName} live={currentLive} elapsed={currentElapsed} apiHost={apiHost} />
                </View>
            )}

            {isListLoading ? (
                <Text style={styles.loadingText}>Loading play list…</Text>
            ) : items.length === 0 ? (
                <Text style={styles.emptyText}>
                    Your play list is empty. Open any game page and use the Add to Play List toggle to queue up what you want to play next.
                </Text>
            ) : (
                <>
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
                                        containerStyle={{ width: gridCardW }}
                                    />
                                ))}
                            </View>
                        </>
                    )}
                </>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    scrollContent: { paddingBottom: 48 },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: 40, textAlign: 'center' },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: 40, textAlign: 'center' },

    header: { paddingTop: 24, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 24 },
    eyebrow: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 30, letterSpacing: 0.5 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, marginTop: 6 },

    currentSection: { paddingBottom: 28 },
    current: {
        height: 180,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        justifyContent: 'flex-end',
    },
    currentLive: { borderColor: ACCENT_BD },
    currentBody: { padding: 20, gap: 6 },
    currentEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    currentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT },
    currentEyebrow: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
    currentTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 24, letterSpacing: 0.3 },
    currentTime: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 13 },

    queueSection: { paddingBottom: 24 },
    queueHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    queueLabel: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
    queueHint: { marginLeft: 'auto', color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },

    restSep: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
    restSepLine: { flex: 1, height: 1, backgroundColor: colors.border },
    restSepLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },

    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: ACCENT_BD,
        borderRadius: radius, overflow: 'hidden',
    },
    cardActive: { borderColor: ACCENT, opacity: 0.9 },

    imgWrap: { width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    img: { width: '100%', height: '100%' },
    numBadge: {
        position: 'absolute', top: 8, left: 8, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5,
        backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', zIndex: 2,
    },
    numText: { color: '#06140d', fontFamily: fonts.uiBold, fontSize: 11 },
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
