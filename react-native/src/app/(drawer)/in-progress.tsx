import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, Text, View, Pressable } from 'react-native'

import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getHltbIndex } from '@/api/hltb'
import { getOrder, setOrder } from '@/api/order'
import { DraggableList, type DraggableListRenderItem } from '@/components/shared/DraggableList'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
import { computeHltbProgress } from '@/utils/hltbProgress'
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'
import type { HltbEntry } from 'gaming-journal-contracts/hltb'

// Port of collections/in-progress.md. Same queue/rest/DraggableList/single-column-grid-adaptation
// shape as Backlog (see backlog.tsx's comment for why it's single-column, not a multi-col grid) —
// this screen adds the HLTB fill-bar. computeHltbProgress() ported verbatim from
// InProgress.svelte's progressData() function (read the source directly, not just the doc) into
// src/utils/hltbProgress.ts as shared pure logic.
//
// Subtitle differs from Backlog's: always shows both hours AND game count together when
// totalMins > 0 ("Xh invested across N paused games"), not an either/or — read directly off
// InProgress.svelte rather than assuming symmetry with Backlog's subtitle logic.
type InProgressItem = { appid: number; name: string; playtime: number; hltb?: HltbEntry }

export default function InProgressScreen() {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const hltbQuery = useQuery({ queryKey: ['hltbIndex'], queryFn: getHltbIndex })
    const orderQuery = useQuery({ queryKey: ['order', 'in-progress'], queryFn: () => getOrder('in-progress') })
    const apiHostQuery = useApiHost()
    const queryClient = useQueryClient()

    const orderMutation = useMutation({
        mutationFn: (appids: number[]) => setOrder('in-progress', appids),
        onSuccess: (data) => queryClient.setQueryData(['order', 'in-progress'], data),
    })

    const items: InProgressItem[] = useMemo(() => {
        const flags = flagsQuery.data
        const games = gamesQuery.data
        const hltbList = hltbQuery.data
        const savedOrder = orderQuery.data
        if (!flags || !games || !hltbList || !savedOrder) return []

        const gameMap = new Map(games.map(g => [g.appid, g]))
        const hltbMap = new Map(hltbList.map(h => [h.appid, h]))
        const ids = Object.entries(flags).filter(([, f]) => f.inProgress).map(([id]) => Number(id))

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
    }, [flagsQuery.data, gamesQuery.data, hltbQuery.data, orderQuery.data])

    const totalMins = items.reduce((s, i) => s + i.playtime, 0)
    const subtitle = totalMins > 0
        ? `${formatPlaytime(totalMins)} invested across ${items.length} paused game${items.length !== 1 ? 's' : ''}`
        : `${items.length} game${items.length !== 1 ? 's' : ''} paused`

    const apiHost = apiHostQuery.data
    const isLoading = flagsQuery.isLoading || gamesQuery.isLoading || hltbQuery.isLoading || orderQuery.isLoading

    function handleReorder(newItems: InProgressItem[]) {
        orderMutation.mutate(newItems.map(i => i.appid))
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

    const renderItem = ({ item, drag, isActive, getIndex }: DraggableListRenderItem<InProgressItem>) => {
        const index = getIndex() ?? 0
        const isQueue = index < 3
        const progress = computeHltbProgress(item.playtime, item.hltb)
        const played = item.playtime > 0 ? formatPlaytime(item.playtime) : null

        const cardStyle = StyleSheet.flatten([
            styles.card,
            isQueue && styles.cardQueue,
            isActive && styles.cardActive,
        ])

        return (
            <View>
                {index === 3 && (
                    <Text style={styles.restDivider}>Queue · {items.length - 3} more</Text>
                )}
                <Link href={`/game/${item.appid}` as never} asChild>
                    <Pressable onLongPress={drag} style={cardStyle}>
                        <View style={styles.cardImageWrap}>
                            {apiHost && (
                                <Image
                                    source={{ uri: `${apiHost}/relay/images/steam/games/${item.appid}/header.jpg` }}
                                    style={styles.cardImage}
                                    contentFit="cover"
                                    cachePolicy="memory-disk"
                                    recyclingKey={String(item.appid)}
                                />
                            )}
                            {isQueue && <Text style={styles.queueBadge}>{index + 1}</Text>}
                        </View>
                        <View style={styles.cardBody}>
                            <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
                            {played && <Text style={styles.cardPlayed}>{played} played</Text>}
                            {progress && (
                                <>
                                    <View style={styles.barTrack}>
                                        <View style={[styles.barFill, { width: `${progress.fillPct}%` }]} />
                                        {progress.ticks.map((tick, i) => (
                                            <View key={i} style={[styles.barTick, { left: `${tick.pct}%` }]} />
                                        ))}
                                    </View>
                                    <Text style={styles.progressLabel}>{progress.label}</Text>
                                </>
                            )}
                        </View>
                    </Pressable>
                </Link>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Collection</Text>
                <Text style={styles.title}>In Progress</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <DraggableList
                data={items}
                keyExtractor={(item) => String(item.appid)}
                onReorder={handleReorder}
                renderItem={renderItem}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    header: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    eyebrow: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
    restDivider: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase', padding: spacing.md, paddingBottom: spacing.xs },
    card: {
        flexDirection: 'row', gap: spacing.sm, margin: spacing.xs, padding: spacing.xs,
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius,
    },
    cardQueue: { borderColor: colors.borderAct },
    cardActive: { backgroundColor: colors.accentBg },
    cardImageWrap: { width: 100, aspectRatio: 460 / 215, borderRadius: radius, overflow: 'hidden', backgroundColor: colors.bgHover },
    cardImage: { width: '100%', height: '100%' },
    queueBadge: {
        position: 'absolute', top: 4, left: 4, color: colors.text, fontFamily: fonts.uiBold, fontSize: 11,
        backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, width: 18, height: 18, textAlign: 'center', lineHeight: 18,
    },
    cardBody: { flex: 1, justifyContent: 'center', gap: 4 },
    cardName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    cardPlayed: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    barTrack: {
        height: 6, borderRadius: 3, backgroundColor: colors.progressBg, overflow: 'hidden',
        marginTop: 2, position: 'relative',
    },
    barFill: { height: '100%', backgroundColor: colors.progress, borderRadius: 3 },
    barTick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
    progressLabel: { color: colors.progress, fontFamily: fonts.ui, fontSize: 10 },
})
