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
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'
import type { HltbEntry } from 'gaming-journal-contracts/hltb'

// Faithful port of Backlog.svelte + public/css/backlog.css — a 3-across "▶ Up Next" row of landscape
// HERO cards (art on top, number badge top-left, HLTB-estimate badge top-right over the image, then
// title + "Xh played"; no progress bar) followed by a multi-column "Queue · N more" grid of the same
// card in miniature. An earlier native pass collapsed both into a single-column list of horizontal
// thumb+text rows — this restores the web structure. See in-progress.tsx for the shared layout notes.
//
// Reorder: trio is a HORIZONTAL DraggableFlatList (long-press a hero card, drag left/right); the
// permuted trio + untouched grid tail is persisted as the full order. Grid tail is tap-to-open only.

// Backlog page accent — the indigo `--backlog-accent` from backlog.css (page-scoped on the web).
const ACCENT = '#7c6fcd'
const ACCENT_BD = 'rgba(124, 111, 205, 0.35)'
const ACCENT_LO = 'rgba(124, 111, 205, 0.15)'
const GAP = 16

// HLTB estimate badge label — mirrors Backlog.svelte's hltbLabel (prefer main story, else
// completionist) + fmtHours rounding (<1h → minutes, <10h → one decimal, else whole).
function hoursLabel(hours: number | null | undefined): string | null {
    if (!hours) return null
    if (hours < 1) return `${Math.round(hours * 60)}m`
    if (hours < 10) return `${hours.toFixed(1)}h`
    return `${Math.round(hours)}h`
}

type BacklogItem = { appid: number; name: string; playtime: number; hltb?: HltbEntry }

function HeroCard({
    item,
    apiHost,
    index,
    showNumber,
    containerStyle,
    isActive,
    picked,
    onLongPress,
}: {
    item: BacklogItem
    apiHost: string | undefined
    index: number
    showNumber: boolean
    containerStyle: ViewStyle
    isActive?: boolean
    picked?: boolean
    onLongPress?: () => void
}) {
    const est = hoursLabel(item.hltb?.gameplayMain ?? item.hltb?.gameplayCompletionist)
    const played = item.playtime > 0 ? formatPlaytime(item.playtime) : null

    // `Link asChild` clones its child and rejects an array of styles — flatten to one object.
    const cardStyle = StyleSheet.flatten([
        styles.card,
        showNumber && styles.cardUpNext,
        isActive && styles.cardActive,
        picked && styles.cardPicked,
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
                    <View style={[styles.timeBadge, !est && styles.timeBadgeUnknown]}>
                        <Text style={[styles.timeText, !est && styles.timeTextUnknown]}>{est ?? '?h'}</Text>
                    </View>
                </View>
                <View style={styles.body}>
                    <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                    {played && <Text style={styles.played}>{played} played</Text>}
                </View>
            </Pressable>
        </Link>
    )
}

export default function BacklogScreen({ embedded = false }: { embedded?: boolean }) {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const hltbQuery = useQuery({ queryKey: ['hltbIndex'], queryFn: getHltbIndex })
    const orderQuery = useQuery({ queryKey: ['order', 'backlog'], queryFn: () => getOrder('backlog') })
    const apiHostQuery = useApiHost()
    const queryClient = useQueryClient()
    const [pickedAppid, setPickedAppid] = useState<number | null>(null)
    const [localOrder, setLocalOrder] = useState<number[] | null>(null)

    // Content width (window − permanent rail − page padding) sizes the trio and grid cards; same rail
    // math as useGridColumns so the two sections share one left edge.
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
        mutationFn: (appids: number[]) => setOrder('backlog', appids),
        onSuccess: (data) => queryClient.setQueryData(['order', 'backlog'], data),
    })

    const items: BacklogItem[] = useMemo(() => {
        const flags = flagsQuery.data
        const games = gamesQuery.data
        const hltbList = hltbQuery.data
        const savedOrder = localOrder ?? orderQuery.data
        if (!flags || !games || !hltbList || !savedOrder) return []

        const gameMap = new Map(games.map(g => [g.appid, g]))
        const hltbMap = new Map(hltbList.map(h => [h.appid, h]))
        const shouldShow = makeShouldShow(flags, settingsQuery.data ?? {})
        const backlogIds = Object.entries(flags)
            .filter(([id, f]) => f.backlog && shouldShow(id))
            .map(([id]) => Number(id))

        const toItem = (appid: number): BacklogItem => {
            const g: SteamGameRaw | undefined = gameMap.get(appid)
            return { appid, name: g?.name ?? `App ${appid}`, playtime: g?.playtime_forever ?? 0, hltb: hltbMap.get(appid) }
        }

        const sortedByName = backlogIds.map(toItem).sort((a, b) => a.name.localeCompare(b.name))
        const seen = new Set<number>()
        const ordered: BacklogItem[] = []
        for (const appid of savedOrder) {
            const item = sortedByName.find(i => i.appid === appid)
            if (item) { ordered.push(item); seen.add(appid) }
        }
        for (const item of sortedByName) { if (!seen.has(item.appid)) ordered.push(item) }
        return ordered
    }, [flagsQuery.data, settingsQuery.data, gamesQuery.data, hltbQuery.data, orderQuery.data, localOrder])

    const totalHours = items.reduce((sum, i) => sum + (i.hltb?.gameplayMain ?? 0), 0)
    const subtitle = totalHours > 0
        ? `~${Math.round(totalHours)}h of games waiting`
        : `${items.length} game${items.length !== 1 ? 's' : ''} waiting`

    const apiHost = apiHostQuery.data
    const isLoading = flagsQuery.isLoading || settingsQuery.isLoading || gamesQuery.isLoading || hltbQuery.isLoading || orderQuery.isLoading

    const queueItems = items.slice(0, 3)
    const restItems = items.slice(3)

    function randomPick() {
        if (!items.length) return
        setPickedAppid(items[Math.floor(Math.random() * items.length)].appid)
    }

    // Reordering the trio permutes only the first ≤3 ids; persist the full order (new trio + the
    // untouched grid tail).
    function handleTrioReorder(newTrio: BacklogItem[]) {
        const appids = [...newTrio, ...restItems].map(i => i.appid)
        setLocalOrder(appids)
        orderMutation.mutate(appids)
    }

    if (isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading backlog…</Text></View>
    }

    if (!items.length) {
        return (
            <View style={styles.container}>
                <Text style={styles.emptyText}>
                    No games in your backlog yet. Open any game page and toggle the Backlog flag to add it here.
                </Text>
            </View>
        )
    }

    const renderTrioItem = ({ item, drag, isActive, getIndex }: RenderItemParams<BacklogItem>) => (
        <HeroCard
            item={item}
            apiHost={apiHost}
            index={getIndex() ?? 0}
            showNumber
            containerStyle={{ width: trioCardW }}
            isActive={isActive}
            picked={pickedAppid === item.appid}
            onLongPress={drag}
        />
    )

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
            {embedded ? (
                <View style={[styles.metaRow, { paddingHorizontal: PAGE_PAD }]}>
                    <Text style={styles.metaLine}>{subtitle}</Text>
                    <Pressable onPress={randomPick} style={styles.randomBtn}>
                        <Feather name="shuffle" size={15} color={ACCENT} />
                        <Text style={styles.randomBtnText}>Random Pick</Text>
                    </Pressable>
                </View>
            ) : (
                <View style={[styles.header, { paddingHorizontal: PAGE_PAD }]}>
                    <View style={styles.headerBody}>
                        <Text style={styles.eyebrow}>Collection</Text>
                        <Text style={styles.title}>Backlog</Text>
                        <Text style={styles.subtitle}>{subtitle}</Text>
                    </View>
                    <Pressable onPress={randomPick} style={styles.randomBtn}>
                        <Feather name="shuffle" size={15} color={ACCENT} />
                        <Text style={styles.randomBtnText}>Random Pick</Text>
                    </Pressable>
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
                                picked={pickedAppid === item.appid}
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

    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 24,
        paddingTop: 24, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 24,
    },
    headerBody: { flexShrink: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16, paddingBottom: 18 },
    metaLine: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, flexShrink: 1 },
    eyebrow: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 30, letterSpacing: 0.5 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, marginTop: 6 },
    randomBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 10,
        borderWidth: 1, borderColor: ACCENT_BD, borderRadius: radius, backgroundColor: ACCENT_LO, flexShrink: 0,
    },
    randomBtnText: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 13, letterSpacing: 0.4 },

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
    cardPicked: { borderColor: ACCENT, borderWidth: 2 },

    imgWrap: { width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    img: { width: '100%', height: '100%' },
    numBadge: {
        position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 11,
        backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', zIndex: 2,
    },
    numText: { color: '#fff', fontFamily: fonts.uiBold, fontSize: 11 },
    timeBadge: {
        position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(10,10,14,0.75)',
        borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: ACCENT_BD,
    },
    timeBadgeUnknown: { backgroundColor: 'rgba(10,10,14,0.55)', borderColor: colors.border },
    timeText: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.3 },
    timeTextUnknown: { color: colors.textMuted },

    body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 4 },
    name: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13, lineHeight: 17 },
    played: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
})
