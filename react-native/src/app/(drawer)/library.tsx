import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native'

import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getSettings } from '@/api/settings'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { useApiHost } from '@/hooks/useApiHost'
import { useGridColumns } from '@/hooks/useGridColumns'
import { getWithTTL, setWithTTL } from '@/storage/ttl'
import { getPlain, setPlain } from '@/storage/plain'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
import { makeShouldShow } from '@/utils/gameFilter'
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'
import type { GameFlags } from 'gaming-journal-contracts/flags'

// Port of collections/library.md. Sort/dir persist indefinitely (plain AsyncStorage, matching the
// web's plain-localStorage choice); page/query/letter expire (TTL storage) — same split as web, on
// purpose (see storage/plain.ts). Scroll-position restoration is NOT ported — FlatList's virtualized
// scroll-to-offset doesn't map cleanly onto the web's raw scrollTop restore, and it's a much lower-
// value feature on mobile (pull-to-refresh / short sessions) — deliberately deferred, not forgotten.
// Keyboard shortcuts (←/→ page, ↑/↓ scroll) are dropped entirely — no keyboard on touch.
//
// **Real gap found and fixed by the Phase 6 gotcha cross-check pass**: `LibraryPage.svelte` filters
// every game through `loadGameFilter()`/`shouldShow()` (hides childLock/filtered/software-flagged
// games unless Settings reveals them) — this screen never called it at all, so those games were
// showing unconditionally. Added `getFlags`/`getSettings` queries + `makeShouldShow` (the same
// util factored out for the Account screen) at the base of `filteredByQuery`.
const PAGE_SIZE = 48
const ALPHA = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]

type SortKey = 'name-asc' | 'name-desc' | 'playtime-desc' | 'playtime-asc' | 'recent-desc' | 'recent-asc'
const SORT_LABELS: Record<SortKey, string> = {
    'name-asc':      'Name A → Z',
    'name-desc':     'Name Z → A',
    'playtime-desc': 'Most Played',
    'playtime-asc':  'Least Played',
    'recent-desc':   'Recently Played',
    'recent-asc':    'Least Recently',
}

function matchesLetter(name: string, letter: string): boolean {
    const first = name.trim()[0]?.toUpperCase() ?? ''
    if (letter === '#') return !/[A-Z]/.test(first)
    return first === letter
}

export default function LibraryScreen() {
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const apiHostQuery = useApiHost()
    // Web `.lib-grid` fans out fluidly; native mirrors the collection minmax(160px,1fr) target so a
    // desktop-tier tablet fans to ~5–6 columns instead of the old fixed phone/small-tablet density.
    // min:2 mirrors the web's phone-portrait `repeat(2,1fr)` floor (and keeps the unconditional
    // columnWrapperStyle valid — RN throws on a single-column list that sets one).
    const numColumns = useGridColumns(160, { min: 2 })

    const [query, setQuery] = useState('')
    const [debouncedQuery, setDebouncedQuery] = useState('')
    const [sort, setSort] = useState<SortKey>('name-asc')
    const [page, setPage] = useState(1)
    const [letter, setLetter] = useState<string | null>(null)
    const [hydrated, setHydrated] = useState(false)

    // Hydrate persisted state on mount (plain for sort, TTL for page/query/letter).
    useEffect(() => {
        (async () => {
            const [storedSort, storedDir, storedPage, storedQuery, storedLetter] = await Promise.all([
                getPlain('gj_lib_sort'),
                getPlain('gj_lib_dir'),
                getWithTTL<number>('gj_lib_page'),
                getWithTTL<string>('gj_lib_query'),
                getWithTTL<string>('gj_lib_letter'),
            ])
            if (storedSort && storedDir) {
                const key = `${storedSort}-${storedDir}` as SortKey
                if (key in SORT_LABELS) setSort(key)
            }
            if (storedPage) setPage(storedPage)
            if (storedQuery) { setQuery(storedQuery); setDebouncedQuery(storedQuery) }
            if (storedLetter) setLetter(storedLetter)
            setHydrated(true)
        })()
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 200)
        return () => clearTimeout(timer)
    }, [query])

    useEffect(() => { if (hydrated) setWithTTL('gj_lib_query', debouncedQuery) }, [debouncedQuery, hydrated])
    useEffect(() => { if (hydrated) setWithTTL('gj_lib_page', page) }, [page, hydrated])
    useEffect(() => { if (hydrated) setWithTTL('gj_lib_letter', letter) }, [letter, hydrated])

    function changeSort(next: SortKey) {
        setSort(next)
        setPage(1)
        const [s, d] = next.split('-')
        setPlain('gj_lib_sort', s)
        setPlain('gj_lib_dir', d)
    }

    const filteredByQuery = useMemo(() => {
        if (!flagsQuery.data || !settingsQuery.data) return []
        const shouldShow = makeShouldShow(flagsQuery.data, settingsQuery.data)
        const all = (gamesQuery.data ?? []).filter(g => shouldShow(g.appid))
        if (!debouncedQuery.trim()) return all
        const q = debouncedQuery.toLowerCase()
        return all.filter(g => g.name.toLowerCase().includes(q))
    }, [gamesQuery.data, flagsQuery.data, settingsQuery.data, debouncedQuery])

    const availableLetters = useMemo(
        () => new Set(filteredByQuery.map(g => (matchesLetter(g.name, '#') ? '#' : g.name.trim()[0]?.toUpperCase()))),
        [filteredByQuery],
    )

    const filtered = useMemo(
        () => (letter ? filteredByQuery.filter(g => matchesLetter(g.name, letter)) : filteredByQuery),
        [filteredByQuery, letter],
    )

    const sorted = useMemo(() => {
        const [key, dir] = sort.split('-') as ['name' | 'playtime' | 'recent', 'asc' | 'desc']
        const copy = [...filtered]
        copy.sort((a, b) => {
            let cmp = 0
            if (key === 'name') cmp = a.name.localeCompare(b.name)
            else if (key === 'playtime') cmp = a.playtime_forever - b.playtime_forever
            else cmp = (a.rtime_last_played ?? 0) - (b.rtime_last_played ?? 0)
            return dir === 'asc' ? cmp : -cmp
        })
        return copy
    }, [filtered, sort])

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
    const clampedPage = Math.min(page, totalPages)
    const pageItems = sorted.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)
    const apiHost = apiHostQuery.data

    function openSortMenu() {
        openLongPressMenu(
            (Object.keys(SORT_LABELS) as SortKey[]).map(key => ({
                label:  SORT_LABELS[key],
                action: () => changeSort(key),
            })),
        )
    }

    if (gamesQuery.isLoading || flagsQuery.isLoading || settingsQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading library…</Text></View>
    }

    return (
        <View style={styles.container}>
            <View style={styles.controls}>
                <TextInput
                    value={query}
                    onChangeText={(t) => { setQuery(t); setPage(1) }}
                    placeholder="Search library…"
                    placeholderTextColor={colors.textMuted}
                    style={styles.search}
                />
                <Pressable onPress={openSortMenu} style={styles.sortButton}>
                    <Text style={styles.sortButtonText}>{SORT_LABELS[sort]}</Text>
                </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.alphaRow}>
                <Pressable onPress={() => { setLetter(null); setPage(1) }} style={[styles.alphaBtn, !letter && styles.alphaBtnActive]}>
                    <Text style={styles.alphaBtnText}>All</Text>
                </Pressable>
                {ALPHA.map(l => {
                    const disabled = !availableLetters.has(l)
                    return (
                        <Pressable
                            key={l}
                            disabled={disabled}
                            onPress={() => { setLetter(l); setPage(1) }}
                            style={[styles.alphaBtn, letter === l && styles.alphaBtnActive, disabled && styles.alphaBtnDisabled]}
                        >
                            <Text style={[styles.alphaBtnText, disabled && styles.alphaBtnTextDisabled]}>{l}</Text>
                        </Pressable>
                    )
                })}
            </ScrollView>

            <FlatList
                key={numColumns} // FlatList requires remount when numColumns changes
                data={pageItems}
                numColumns={numColumns}
                keyExtractor={(item) => String(item.appid)}
                contentContainerStyle={styles.grid}
                columnWrapperStyle={styles.gridRow}
                ListEmptyComponent={<Text style={styles.emptyText}>No games match.</Text>}
                renderItem={({ item }) => (
                    <GameCard game={item} apiHost={apiHost} numColumns={numColumns} flags={flagsQuery.data?.[item.appid]} />
                )}
            />

            <View style={styles.pager}>
                <Pressable
                    disabled={clampedPage <= 1}
                    onPress={() => setPage(p => Math.max(1, p - 1))}
                    style={[styles.pagerBtn, clampedPage <= 1 && styles.pagerBtnDisabled]}
                >
                    <Text style={styles.pagerBtnText}>‹ Prev</Text>
                </Pressable>
                <Text style={styles.pagerLabel}>{clampedPage} / {totalPages}</Text>
                <Pressable
                    disabled={clampedPage >= totalPages}
                    onPress={() => setPage(p => Math.min(totalPages, p + 1))}
                    style={[styles.pagerBtn, clampedPage >= totalPages && styles.pagerBtnDisabled]}
                >
                    <Text style={styles.pagerBtnText}>Next ›</Text>
                </Pressable>
            </View>
        </View>
    )
}

function GameCard({ game, apiHost, numColumns, flags }: { game: SteamGameRaw; apiHost: string | undefined; numColumns: number; flags: GameFlags | undefined }) {
    // expo-router's <Link asChild> clones its child and merges its own props/style in — passing an
    // array of styles to that child throws ("You are passing an array of styles to a child of
    // <Slot>"). Caught by the screenshot-first recipe (console error on every breakpoint). Flatten
    // first so Link always receives a single plain style object.
    const cardStyle = StyleSheet.flatten([styles.card, { flex: 1 / numColumns }])
    return (
        <Link href={`/game/${game.appid}` as never} asChild>
            <Pressable style={cardStyle} onLongPress={(e) => openGameCardMenu(game.appid, flags, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}>
                {apiHost && (
                    <Image
                        source={{ uri: `${apiHost}/relay/images/steam/games/${game.appid}/header.jpg` }}
                        style={styles.cardImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={String(game.appid)}
                    />
                )}
                <Text style={styles.cardName} numberOfLines={1}>{game.name}</Text>
                <Text style={styles.cardHours}>{formatPlaytime(game.playtime_forever)}</Text>
            </Pressable>
        </Link>
    )
}

const styles = StyleSheet.create({
    container: {
        flex:            1,
        backgroundColor: colors.bg,
    },
    loadingText: {
        color:      colors.textMuted,
        fontFamily: fonts.ui,
        padding:    spacing.lg,
    },
    controls: {
        flexDirection: 'row',
        gap:           spacing.sm,
        padding:       spacing.md,
    },
    search: {
        flex:            1,
        backgroundColor: colors.bgRaised,
        borderWidth:     1,
        borderColor:     colors.border,
        borderRadius:    radius,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        color:           colors.text,
        fontFamily:      fonts.ui,
    },
    sortButton: {
        backgroundColor:   colors.bgRaised,
        borderWidth:       1,
        borderColor:       colors.border,
        borderRadius:      radius,
        paddingHorizontal: spacing.sm,
        justifyContent:    'center',
    },
    sortButtonText: {
        color:      colors.text,
        fontFamily: fonts.ui,
        fontSize:   12,
    },
    alphaRow: {
        flexGrow:          0,
        paddingHorizontal: spacing.md,
        marginBottom:      spacing.sm,
    },
    alphaBtn: {
        paddingHorizontal: spacing.sm,
        paddingVertical:   4,
        marginRight:       4,
        borderRadius:      radius,
        backgroundColor:   colors.bgHover,
    },
    alphaBtnActive: {
        backgroundColor: colors.accent,
    },
    alphaBtnDisabled: {
        opacity: 0.3,
    },
    alphaBtnText: {
        color:      colors.text,
        fontFamily: fonts.ui,
        fontSize:   12,
    },
    alphaBtnTextDisabled: {
        color: colors.textMuted,
    },
    grid: {
        paddingHorizontal: spacing.md,
        paddingBottom:     spacing.md,
    },
    gridRow: {
        gap: spacing.sm,
    },
    emptyText: {
        color:      colors.textMuted,
        fontFamily: fonts.ui,
        textAlign:  'center',
        padding:    spacing.xl,
    },
    card: {
        backgroundColor: colors.bgRaised,
        borderWidth:     1,
        borderColor:     colors.border,
        borderRadius:    radius,
        overflow:        'hidden',
        marginBottom:    spacing.sm,
    },
    cardImage: {
        width:           '100%',
        aspectRatio:     460 / 215,
        backgroundColor: colors.bgHover,
    },
    cardName: {
        color:      colors.text,
        fontFamily: fonts.ui,
        fontSize:   12,
        paddingHorizontal: spacing.xs,
        paddingTop: spacing.xs,
    },
    cardHours: {
        color:      colors.textMuted,
        fontFamily: fonts.ui,
        fontSize:   11,
        paddingHorizontal: spacing.xs,
        paddingBottom: spacing.xs,
    },
    pager: {
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        spacing.md,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    pagerBtn: {
        backgroundColor:   colors.bgHover,
        borderRadius:      radius,
        paddingHorizontal: spacing.md,
        paddingVertical:   spacing.sm,
    },
    pagerBtnDisabled: {
        opacity: 0.4,
    },
    pagerBtnText: {
        color:      colors.accent,
        fontFamily: fonts.uiBold,
        fontSize:   13,
    },
    pagerLabel: {
        color:      colors.textMuted,
        fontFamily: fonts.ui,
        fontSize:   12,
    },
})
