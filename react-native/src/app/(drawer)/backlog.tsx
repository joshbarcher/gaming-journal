import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getHltbIndex } from '@/api/hltb'
import { getOrder, setOrder } from '@/api/order'
import { DraggableList, type DraggableListRenderItem } from '@/components/shared/DraggableList'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'
import type { HltbEntry } from 'gaming-journal-contracts/hltb'

// Port of collections/backlog.md. First real DraggableList integration.
//
// Deliberate layout adaptation, not a 1:1 port: the web version renders a multi-column CSS grid
// (auto-fill minmax(200px,1fr)) with native HTML5 drag-and-drop across two visually separate
// sections (a 3-card "Up Next" row + the rest grid) that are actually one underlying ordered
// array. react-native-draggable-flatlist doesn't reliably support multi-column grid dragging
// (the library's own docs steer toward single-column vertical lists for reorder) — so this is one
// single-column vertical DraggableList instead, with the first 3 items visually marked "Up Next"
// (numbered badge) and a "Queue · N more" divider before item 4, preserving the real behavior
// (one ordered list, first 3 = queue, drag reorders the whole thing) without fighting the library.
//
// Random Pick's border/glow highlight is ported; the web's pulse keyframe animation is not — a
// static highlight instead, deliberately simplified rather than porting a CSS keyframe animation
// via Reanimated for a fairly minor cosmetic detail.
function hoursLabel(hours: number | null | undefined): string | null {
    if (!hours) return null
    if (hours < 1) return `${Math.round(hours * 60)}m`
    if (hours < 10) return `${hours.toFixed(1)}h`
    return `${Math.round(hours)}h`
}

type BacklogItem = { appid: number; name: string; playtime: number; hltb?: HltbEntry }

export default function BacklogScreen() {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const hltbQuery = useQuery({ queryKey: ['hltbIndex'], queryFn: getHltbIndex })
    const orderQuery = useQuery({ queryKey: ['order', 'backlog'], queryFn: () => getOrder('backlog') })
    const apiHostQuery = useApiHost()
    const queryClient = useQueryClient()
    const [pickedAppid, setPickedAppid] = useState<number | null>(null)
    const [localOrder, setLocalOrder] = useState<number[] | null>(null)

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
        const backlogIds = Object.entries(flags).filter(([, f]) => f.backlog).map(([id]) => Number(id))

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
    }, [flagsQuery.data, gamesQuery.data, hltbQuery.data, orderQuery.data, localOrder])

    const totalHours = items.reduce((sum, i) => sum + (i.hltb?.gameplayMain ?? 0), 0)
    const subtitle = totalHours > 0
        ? `~${Math.round(totalHours)}h of games waiting`
        : `${items.length} game${items.length !== 1 ? 's' : ''} waiting`

    const apiHost = apiHostQuery.data
    const isLoading = flagsQuery.isLoading || gamesQuery.isLoading || hltbQuery.isLoading || orderQuery.isLoading

    function randomPick() {
        if (!items.length) return
        setPickedAppid(items[Math.floor(Math.random() * items.length)].appid)
    }

    function handleReorder(newItems: BacklogItem[]) {
        const appids = newItems.map(i => i.appid)
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

    const renderItem = ({ item, drag, isActive, getIndex }: DraggableListRenderItem<BacklogItem>) => {
        const index = getIndex() ?? 0
        const isQueue = index < 3
        const est = hoursLabel(item.hltb?.gameplayMain ?? item.hltb?.gameplayCompletionist)
        const played = item.playtime > 0 ? formatPlaytime(item.playtime) : null
        const picked = pickedAppid === item.appid

        // <Link asChild> requires a single flattened style object, not an array — see the same
        // issue caught (and documented) on the Library screen.
        const cardStyle = StyleSheet.flatten([
            styles.card,
            isQueue && styles.cardQueue,
            isActive && styles.cardActive,
            picked && styles.cardPicked,
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
                            <Text style={[styles.timeBadge, !est && styles.timeBadgeUnknown]}>{est ?? '?h'}</Text>
                        </View>
                        <View style={styles.cardBody}>
                            <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
                            {played && <Text style={styles.cardPlayed}>{played} played</Text>}
                        </View>
                    </Pressable>
                </Link>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.eyebrow}>Collection</Text>
                    <Text style={styles.title}>Backlog</Text>
                    <Text style={styles.subtitle}>{subtitle}</Text>
                </View>
                <Pressable onPress={randomPick} style={styles.randomBtn}>
                    <Text style={styles.randomBtnText}>Random Pick</Text>
                </Pressable>
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
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
        padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    eyebrow: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
    randomBtn: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, justifyContent: 'center' },
    randomBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    restDivider: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase', padding: spacing.md, paddingBottom: spacing.xs },
    card: {
        flexDirection: 'row', gap: spacing.sm, margin: spacing.xs, padding: spacing.xs,
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius,
    },
    cardQueue: { borderColor: colors.borderAct },
    cardActive: { backgroundColor: colors.accentBg },
    cardPicked: { borderColor: colors.accent, borderWidth: 2 },
    cardImageWrap: { width: 100, aspectRatio: 460 / 215, borderRadius: radius, overflow: 'hidden', backgroundColor: colors.bgHover },
    cardImage: { width: '100%', height: '100%' },
    queueBadge: {
        position: 'absolute', top: 4, left: 4, color: colors.text, fontFamily: fonts.uiBold, fontSize: 11,
        backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, width: 18, height: 18, textAlign: 'center', lineHeight: 18,
    },
    timeBadge: {
        position: 'absolute', top: 4, right: 4, color: colors.accent, fontFamily: fonts.uiBold, fontSize: 10,
        backgroundColor: 'rgba(10,10,14,0.75)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    },
    timeBadgeUnknown: { color: colors.textMuted },
    cardBody: { flex: 1, justifyContent: 'center', gap: 2 },
    cardName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    cardPlayed: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
})
