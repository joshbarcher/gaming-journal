import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { getSteamGamesList } from '@/api/games'
import { getAllLocalReviews } from '@/api/localReview'
import { LegendaryStars } from '@/components/shared/LegendaryStars'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { LocalReview } from 'gaming-journal-contracts/localReview'

type SortBy = 'stars' | 'name' | 'recent'
const SORTS: { key: SortBy; label: string }[] = [
    { key: 'stars', label: 'By Stars' },
    { key: 'name', label: 'By Name' },
    { key: 'recent', label: 'Recently Reviewed' },
]

// Port of MyReviews.svelte (account/my-reviews.md). Sort is a row of pill buttons instead of a
// native `<select>` (RN has no select equivalent, and 3 fixed options don't need a picker sheet).
// Search is plain reactive `onChangeText` — the real web has no debounce either (`bind:value`),
// so none was added here.
export default function MyReviewsScreen() {
    const reviewsQuery = useQuery({ queryKey: ['allLocalReviews'], queryFn: getAllLocalReviews })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const breakpoint = useBreakpoint()
    const numColumns = breakpoint === 'mobilePortrait' ? 2 : 3

    const [search, setSearch] = useState('')
    const [sortBy, setSortBy] = useState<SortBy>('stars')

    const gameMap = useMemo(() => new Map((gamesQuery.data ?? []).map(g => [g.appid, g])), [gamesQuery.data])

    const allEntries = useMemo(() => Object.entries(reviewsQuery.data ?? {}) as [string, LocalReview][], [reviewsQuery.data])

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim()
        const entries = allEntries.filter(([appid, rev]) => {
            if (!q) return true
            const name = (gameMap.get(Number(appid))?.name ?? '').toLowerCase()
            const tags = (rev.tags ?? []).map(t => t.toLowerCase())
            return name.includes(q) || tags.some(t => t.includes(q))
        })
        return [...entries].sort(([aId, aRev], [bId, bRev]) => {
            if (sortBy === 'stars') {
                const diff = (bRev.stars ?? 0) - (aRev.stars ?? 0)
                if (diff !== 0) return diff
                return (gameMap.get(Number(aId))?.name ?? '').localeCompare(gameMap.get(Number(bId))?.name ?? '')
            }
            if (sortBy === 'name') return (gameMap.get(Number(aId))?.name ?? '').localeCompare(gameMap.get(Number(bId))?.name ?? '')
            if (sortBy === 'recent') return (bRev.updatedAt ?? '').localeCompare(aRev.updatedAt ?? '')
            return 0
        })
    }, [allEntries, gameMap, search, sortBy])

    if (reviewsQuery.isLoading || gamesQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading reviews…</Text></View>
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Collection</Text>
                <Text style={styles.title}>My Reviews</Text>
            </View>

            {allEntries.length === 0 ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>No reviews yet</Text>
                    <Text style={styles.emptySub}>Visit a game page and write your first review.</Text>
                </View>
            ) : (
                <>
                    <View style={styles.controls}>
                        <TextInput
                            style={styles.search}
                            placeholder="Search by name or tag…"
                            placeholderTextColor={colors.textMuted}
                            value={search}
                            onChangeText={setSearch}
                        />
                        <View style={styles.sortRow}>
                            {SORTS.map(s => (
                                <Pressable key={s.key} style={[styles.sortPill, sortBy === s.key && styles.sortPillActive]} onPress={() => setSortBy(s.key)}>
                                    <Text style={[styles.sortPillText, sortBy === s.key && styles.sortPillTextActive]}>{s.label}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>

                    {filtered.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyTitle}>No results</Text>
                            <Text style={styles.emptySub}>Try a different search.</Text>
                        </View>
                    ) : (
                        <FlatList
                            key={numColumns}
                            data={filtered}
                            numColumns={numColumns}
                            keyExtractor={([appid]) => appid}
                            contentContainerStyle={styles.grid}
                            columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
                            renderItem={({ item: [appid, rev] }) => (
                                <ReviewCard appid={Number(appid)} rev={rev} name={gameMap.get(Number(appid))?.name ?? `App ${appid}`} apiHost={apiHost} numColumns={numColumns} />
                            )}
                            initialNumToRender={12}
                            windowSize={7}
                            removeClippedSubviews
                        />
                    )}
                </>
            )}
        </View>
    )
}

function ReviewCard({ appid, rev, name, apiHost, numColumns }: { appid: number; rev: LocalReview; name: string; apiHost: string | undefined; numColumns: number }) {
    const stars = rev.stars ?? 0
    const tags = rev.tags ?? []
    const excerpt = rev.review ?? ''

    const cardStyle = StyleSheet.flatten([styles.card, { flexBasis: `${100 / numColumns}%` as const }])

    return (
        <Link href={`/game/${appid}` as never} asChild>
            <Pressable style={cardStyle}>
                <View style={styles.cardImgWrap}>
                    {!!apiHost && (
                        // Web dims unrated cards via `filter: saturate(0.4)` — expo-image has no
                        // saturation filter prop, so opacity approximates the same "dimmed, not
                        // grayscale" visual intent rather than pulling in a filter dependency.
                        <Image
                            source={{ uri: `${apiHost}/relay/images/steam/games/${appid}/header.jpg` }}
                            style={[styles.cardImg, stars === 0 && styles.cardImgUnrated]}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={String(appid)}
                        />
                    )}
                    {stars > 0 && (
                        <View style={styles.cardStarsOverlay}>
                            <LegendaryStars stars={stars} variant="card" size={13} />
                        </View>
                    )}
                </View>
                <View style={styles.cardBody}>
                    <Text style={styles.cardName} numberOfLines={1}>{name}</Text>
                    {tags.length > 0 && (
                        <View style={styles.cardTags}>
                            {tags.slice(0, 3).map(tag => <Text key={tag} style={styles.cardTag}>{tag}</Text>)}
                        </View>
                    )}
                    {!!excerpt && <Text style={styles.cardExcerpt} numberOfLines={2}>{excerpt}</Text>}
                </View>
            </Pressable>
        </Link>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    header: { padding: spacing.md, gap: 2 },
    eyebrow: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.xl },
    emptyTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 15 },
    emptySub: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    controls: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.sm },
    search: { backgroundColor: colors.bgHover, borderWidth: 1, borderColor: colors.border, borderRadius: radius, color: colors.text, fontFamily: fonts.ui, fontSize: 13, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
    sortRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
    sortPill: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    sortPillActive: { backgroundColor: colors.accentBg, borderColor: colors.borderAct },
    sortPillText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11 },
    sortPillTextActive: { color: colors.accent },
    grid: { padding: spacing.md, gap: spacing.sm },
    row: { gap: spacing.sm },
    card: { padding: 4, gap: 6 },
    cardImgWrap: { position: 'relative', borderRadius: radius, overflow: 'hidden', backgroundColor: colors.bgHover },
    cardImg: { width: '100%', aspectRatio: 460 / 215 },
    cardImgUnrated: { opacity: 0.3 },
    cardStarsOverlay: {
        position: 'absolute', top: 8, right: 8,
        backgroundColor: 'rgba(10,10,16,0.75)', borderRadius: 6,
        paddingHorizontal: 7, paddingVertical: 3,
    },
    cardBody: { gap: 3 },
    cardName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    cardTag: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 9, backgroundColor: colors.bgHover, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
    cardExcerpt: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, lineHeight: 15 },
})
