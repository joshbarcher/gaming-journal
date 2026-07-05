import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getHltbIndex } from '@/api/hltb'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'
import type { HltbEntry } from 'gaming-journal-contracts/hltb'

// Port of collections/abandoned.md. Real naming mismatch confirmed in the flags data itself (not
// just the doc): the flag field is `dropped`, page/route/nav label is "Abandoned" — used
// `f.dropped` throughout, matching the doc's explicit warning.
//
// Simple read-only grid, no queue/hero/ordering (confirmed by reading Abandoned.svelte directly) —
// sorted by playtime **descending** (most-invested-then-abandoned first), a specific detail that
// isn't in the doc's prose but is in the actual sort call (`.sort((a,b) => b.playtime - a.playtime)`).
//
// Deliberately simplified: the web version desaturates card images via CSS
// (`filter: saturate(0.75) brightness(0.9)`, matching Backlog's "waiting" treatment) — RN's Image
// has no direct CSS-filter equivalent without extra image-processing work, so this uses a
// semi-transparent dark overlay instead to convey the same "set aside" visual tone. Not pixel-exact,
// same idea.
type AbandonedItem = { appid: number; name: string; playtime: number; hltb?: HltbEntry }

function remainingLabel(playtimeMin: number, hltb: HltbEntry | undefined): string | null {
    const mainH = hltb?.gameplayMain
    if (!mainH) return null
    const remainingMin = mainH * 60 - playtimeMin
    if (remainingMin <= 0) return null
    return formatPlaytime(remainingMin)
}

export default function AbandonedScreen() {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const hltbQuery = useQuery({ queryKey: ['hltbIndex'], queryFn: getHltbIndex })
    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const numColumns = breakpoint === 'mobilePortrait' ? 2 : 3
    const showInvestedBadge = breakpoint !== 'mobilePortrait' // matches web: hidden on 2-col cards, "too cramped"

    const items: AbandonedItem[] = useMemo(() => {
        const flags = flagsQuery.data
        const games = gamesQuery.data
        const hltbList = hltbQuery.data
        if (!flags || !games || !hltbList) return []

        const gameMap = new Map(games.map(g => [g.appid, g]))
        const hltbMap = new Map(hltbList.map(h => [h.appid, h]))
        const ids = Object.entries(flags).filter(([, f]) => f.dropped).map(([id]) => Number(id))

        return ids
            .map((appid): AbandonedItem => {
                const g: SteamGameRaw | undefined = gameMap.get(appid)
                return { appid, name: g?.name ?? `App ${appid}`, playtime: g?.playtime_forever ?? 0, hltb: hltbMap.get(appid) }
            })
            .sort((a, b) => b.playtime - a.playtime)
    }, [flagsQuery.data, gamesQuery.data, hltbQuery.data])

    const totalMin = items.reduce((s, i) => s + i.playtime, 0)
    const subtitle = totalMin > 0
        ? `${items.length} game${items.length !== 1 ? 's' : ''} set aside · ${formatPlaytime(totalMin)} invested`
        : `${items.length} game${items.length !== 1 ? 's' : ''} set aside`

    const apiHost = apiHostQuery.data
    const isLoading = flagsQuery.isLoading || gamesQuery.isLoading || hltbQuery.isLoading

    if (isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading…</Text></View>
    }

    if (!items.length) {
        return (
            <View style={styles.container}>
                <Text style={styles.emptyText}>
                    No abandoned games. Open any game page and toggle the Dropped flag to track it here.
                </Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Collection</Text>
                <Text style={styles.title}>Abandoned</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <FlatList
                key={numColumns}
                data={items}
                numColumns={numColumns}
                keyExtractor={(item) => String(item.appid)}
                contentContainerStyle={styles.grid}
                columnWrapperStyle={styles.gridRow}
                renderItem={({ item }) => {
                    const invested = item.playtime > 0 ? formatPlaytime(item.playtime) : null
                    const remaining = remainingLabel(item.playtime, item.hltb)
                    const cardStyle = StyleSheet.flatten([styles.card, { flex: 1 / numColumns }])
                    return (
                        <Link href={`/game/${item.appid}` as never} asChild>
                            <Pressable style={cardStyle}>
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
                                    <View style={styles.cardFog} />
                                    {showInvestedBadge && invested && (
                                        <Text style={styles.investedBadge}>{invested} in</Text>
                                    )}
                                </View>
                                <View style={styles.cardBody}>
                                    <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                                    {remaining ? (
                                        <Text style={styles.cardMeta}>{remaining} left to finish</Text>
                                    ) : (
                                        <Text style={styles.cardMetaUnknown}>Unfinished</Text>
                                    )}
                                </View>
                            </Pressable>
                        </Link>
                    )
                }}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    header: { padding: spacing.md },
    eyebrow: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
    grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    gridRow: { gap: spacing.sm },
    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden', marginBottom: spacing.sm,
    },
    cardImageWrap: { width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    cardImage: { width: '100%', height: '100%' },
    cardFog: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,18,16,0.35)' },
    investedBadge: {
        position: 'absolute', top: 4, right: 4, color: colors.text, fontFamily: fonts.uiBold, fontSize: 10,
        backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    },
    cardBody: { padding: spacing.xs, gap: 2 },
    cardName: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    cardMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    cardMetaUnknown: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, fontStyle: 'italic' },
})
