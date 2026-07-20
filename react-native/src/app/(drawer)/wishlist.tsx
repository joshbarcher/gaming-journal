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
import { getSettings } from '@/api/settings'
import { getWishlist } from '@/api/wishlist'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { useApiHost } from '@/hooks/useApiHost'
import { useGridColumns } from '@/hooks/useGridColumns'
import { getWithTTL, setWithTTL } from '@/storage/ttl'
import { getPlain, setPlain } from '@/storage/plain'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { makeShouldShow } from '@/utils/gameFilter'
import type { WishlistGame } from 'gaming-journal-contracts/wishlist'
import type { GameFlags } from 'gaming-journal-contracts/flags'

// Port of collections/wishlist.md. Reuses library.css's grid classes directly on the web side (no
// wishlist-specific @media rules exist) — confirmed by reading WishlistPage.svelte's class names —
// so the same 2/3/3 column breakpoint decision from the Library screen applies here unchanged.
//
// Found the doc's data-source claim was wrong twice over, the same "verify live, not the doc/code"
// lesson as before: collections/wishlist.md says GET /api/local-wishlist returns SteamGame[]; the
// real endpoint (confirmed by reading WishlistPage.svelte:166) is GET /relay/api/wishlist, and
// /api/local-wishlist actually returns a much thinner {items: Record<appid,{dateAdded}>} shape.
// Also: the Svelte source reads `retail.final_formatted` for the retail price fallback, but the
// real live payload's field is `formatted` — used the real field name, not the source's (likely
// dead) reference.
//
// query is deliberately NOT persisted here (unlike Library) — the doc's explicit storage-key list
// for wishlist only names sort/dir/page/letter, not query; kept that distinction faithful rather
// than assuming symmetry with Library.
//
// **Two real gaps found and fixed by the Phase 6 gotcha cross-check pass**:
// (1) `WishlistPage.svelte` filters through `loadGameFilter()`/`shouldShow()` (childLock/filtered/
//     software) exactly like Library — this screen never called it. Added `getFlags`/`getSettings`
//     + `makeShouldShow`.
// (2) The doc's own "Gotchas" section describes `hideUnavailable` as a session-only in-page toggle
//     button — reading `WishlistPage.svelte`'s CURRENT real source shows this is stale: there is no
//     toggle/button anywhere in the template. `hideUnavailable` is set exactly once, from
//     `settings.hideUnavailable` at mount, and used purely as a read-only filter — no user control
//     on this page changes it at all. The Switch this screen originally built (defaulting to
//     `false` regardless of the real persisted setting) was a double deviation: a control that
//     shouldn't exist, initialized wrong besides. Removed the Switch; `hideUnavailable` is now
//     read straight from `getSettings()` and applied as a plain filter, matching the real,
//     current, doc-contradicting source exactly.
const PAGE_SIZE = 48
const ALPHA = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]

type SortKey = 'priority-asc' | 'priority-desc' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'discount-asc' | 'discount-desc' | 'added-asc' | 'added-desc' | 'release-asc' | 'release-desc'
const SORT_LABELS: Record<SortKey, string> = {
    'priority-asc':  'Priority',
    'priority-desc': 'Priority (rev)',
    'name-asc':      'Name A→Z',
    'name-desc':     'Name Z→A',
    'price-asc':     'Price ↑',
    'price-desc':    'Price ↓',
    'discount-asc':  'Discount ↑',
    'discount-desc': 'Discount ↓',
    'added-asc':     'Date Added ↑',
    'added-desc':    'Date Added ↓',
    'release-asc':   'Release Date ↑',
    'release-desc':  'Release Date ↓',
}

function matchesLetter(name: string, letter: string): boolean {
    const first = name.trim()[0]?.toUpperCase() ?? ''
    if (letter === '#') return !/[A-Z]/.test(first)
    return first === letter
}

export default function WishlistScreen() {
    const wishlistQuery = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const apiHostQuery = useApiHost()
    // Wishlist reuses the web's `.lib-grid`, so it shares Library's fluid minmax(160px,1fr) target —
    // a desktop-tier tablet fans to ~5–6 columns instead of the old fixed 2/3 phone density. min:2
    // mirrors the web's phone-portrait `repeat(2,1fr)` floor (and keeps columnWrapperStyle valid).
    const numColumns = useGridColumns(160, { min: 2 })

    const [query, setQuery] = useState('') // NOT persisted — see comment above
    const [sort, setSort] = useState<SortKey>('priority-asc')
    const [page, setPage] = useState(1)
    const [letter, setLetter] = useState<string | null>(null)
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        (async () => {
            const [storedSort, storedDir, storedPage, storedLetter] = await Promise.all([
                getPlain('gj_wl_sort'),
                getPlain('gj_wl_dir'),
                getWithTTL<number>('gj_wl_page'),
                getWithTTL<string>('gj_wl_letter'),
            ])
            if (storedSort && storedDir) {
                const key = `${storedSort}-${storedDir}` as SortKey
                if (key in SORT_LABELS) setSort(key)
            }
            if (storedPage) setPage(storedPage)
            if (storedLetter) setLetter(storedLetter)
            setHydrated(true)
        })()
    }, [])

    useEffect(() => { if (hydrated) setWithTTL('gj_wl_page', page) }, [page, hydrated])
    useEffect(() => { if (hydrated) setWithTTL('gj_wl_letter', letter) }, [letter, hydrated])

    function changeSort(next: SortKey) {
        setSort(next)
        setPage(1)
        const [s, d] = next.split('-')
        setPlain('gj_wl_sort', s)
        setPlain('gj_wl_dir', d)
    }

    const baseGames = useMemo(() => {
        if (!flagsQuery.data || !settingsQuery.data) return []
        const shouldShow = makeShouldShow(flagsQuery.data, settingsQuery.data)
        const all = (wishlistQuery.data ?? []).filter(g => shouldShow(g.appid))
        return settingsQuery.data.hideUnavailable ? all.filter(g => !g.store?.unavailable) : all
    }, [wishlistQuery.data, flagsQuery.data, settingsQuery.data])

    const filteredByQuery = useMemo(() => {
        if (!query.trim()) return baseGames
        const q = query.toLowerCase()
        return baseGames.filter(g => g.name.toLowerCase().includes(q))
    }, [baseGames, query])

    const availableLetters = useMemo(
        () => new Set(filteredByQuery.map(g => (matchesLetter(g.name, '#') ? '#' : g.name.trim()[0]?.toUpperCase()))),
        [filteredByQuery],
    )

    const filtered = useMemo(
        () => (letter ? filteredByQuery.filter(g => matchesLetter(g.name, letter)) : filteredByQuery),
        [filteredByQuery, letter],
    )

    const sorted = useMemo(() => {
        const [key, dir] = sort.split('-') as ['priority' | 'name' | 'price' | 'discount' | 'added' | 'release', 'asc' | 'desc']
        const flip = dir === 'asc' ? 1 : -1
        const copy = [...filtered]
        copy.sort((a, b) => {
            switch (key) {
                case 'name':
                    return flip * a.name.localeCompare(b.name)
                case 'price': {
                    const pa = a.itad?.bestPrice?.price ?? Infinity
                    const pb = b.itad?.bestPrice?.price ?? Infinity
                    return flip * (pa - pb)
                }
                case 'discount':
                    return flip * ((a.itad?.bestPrice?.cut ?? 0) - (b.itad?.bestPrice?.cut ?? 0))
                case 'added':
                    return flip * ((a.wishlist?.dateAdded ?? 0) - (b.wishlist?.dateAdded ?? 0))
                case 'release': {
                    const fallback = flip === -1 ? '9999-99-99' : '0000-00-00'
                    const ra = a.store?.releaseDateIso ?? (a.store?.comingSoon ? '9999-99-99' : fallback)
                    const rb = b.store?.releaseDateIso ?? (b.store?.comingSoon ? '9999-99-99' : fallback)
                    return flip * ra.localeCompare(rb)
                }
                default:
                    return flip * ((a.wishlist?.priority ?? 9999) - (b.wishlist?.priority ?? 9999))
            }
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

    if (wishlistQuery.isLoading || flagsQuery.isLoading || settingsQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading wishlist…</Text></View>
    }

    return (
        <View style={styles.container}>
            <View style={styles.controls}>
                <TextInput
                    value={query}
                    onChangeText={(t) => { setQuery(t); setPage(1) }}
                    placeholder="Search wishlist…"
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
                key={numColumns}
                data={pageItems}
                numColumns={numColumns}
                keyExtractor={(item) => String(item.appid)}
                contentContainerStyle={styles.grid}
                columnWrapperStyle={styles.gridRow}
                ListEmptyComponent={<Text style={styles.emptyText}>No games match your search.</Text>}
                renderItem={({ item }) => <WishlistCard game={item} apiHost={apiHost} numColumns={numColumns} flags={flagsQuery.data?.[item.appid]} />}
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

function WishlistCard({ game, apiHost, numColumns, flags }: { game: WishlistGame; apiHost: string | undefined; numColumns: number; flags: GameFlags | undefined }) {
    const bp = game.itad?.bestPrice
    const retail = game.store?.price
    const onSale = (bp?.cut ?? 0) > 0
    const cardStyle = StyleSheet.flatten([styles.card, { flex: 1 / numColumns }])

    return (
        <Link href={`/game/${game.appid}` as never} asChild>
            <Pressable style={cardStyle} onLongPress={(e) => openGameCardMenu(game.appid, flags, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}>
                <View>
                    {apiHost && (
                        <Image
                            source={{ uri: `${apiHost}/relay/images/steam/games/${game.appid}/header.jpg` }}
                            style={styles.cardImage}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={String(game.appid)}
                        />
                    )}
                    {game.store?.unavailable && (
                        <View style={styles.badgeUnavailable}><Text style={styles.badgeText}>Unavailable</Text></View>
                    )}
                    {game.wishlist?.local && (
                        <View style={styles.badgeLocal}><Text style={styles.badgeText}>Local Wishlist</Text></View>
                    )}
                    {game.flags?.alert && (
                        <View style={[styles.badgeAlert, onSale && styles.badgeAlertActive]}>
                            <Text style={styles.badgeText}>{onSale ? 'ON SALE' : 'Watching'}</Text>
                        </View>
                    )}
                </View>
                <Text style={styles.cardName} numberOfLines={1}>{game.name}</Text>
                {bp ? (
                    <Text style={styles.priceLine}>
                        {bp.price === 0 ? 'Free' : `$${bp.price.toFixed(2)}`} · {bp.store}
                        {bp.cut > 0 ? `  -${bp.cut}%` : ''}
                    </Text>
                ) : game.store?.isFree ? (
                    <Text style={styles.priceLine}>Free</Text>
                ) : retail?.formatted ? (
                    <Text style={styles.priceLine}>{retail.formatted}</Text>
                ) : (
                    <Text style={styles.priceNone}>No price data</Text>
                )}
            </Pressable>
        </Link>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    controls: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
    search: {
        flex: 1, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        color: colors.text, fontFamily: fonts.ui,
    },
    sortButton: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, paddingHorizontal: spacing.sm, justifyContent: 'center',
    },
    sortButtonText: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    alphaRow: { flexGrow: 0, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
    alphaBtn: {
        paddingHorizontal: spacing.sm, paddingVertical: 4, marginRight: 4,
        borderRadius: radius, backgroundColor: colors.bgHover,
    },
    alphaBtnActive: { backgroundColor: colors.accent },
    alphaBtnDisabled: { opacity: 0.3 },
    alphaBtnText: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    alphaBtnTextDisabled: { color: colors.textMuted },
    grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    gridRow: { gap: spacing.sm },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, textAlign: 'center', padding: spacing.xl },
    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden', marginBottom: spacing.sm,
    },
    cardImage: { width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    cardName: { color: colors.text, fontFamily: fonts.ui, fontSize: 12, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
    priceLine: { color: colors.progress, fontFamily: fonts.ui, fontSize: 11, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
    priceNone: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
    badgeUnavailable: {
        position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(200,60,60,0.85)',
        borderRadius: radius, paddingHorizontal: 6, paddingVertical: 2,
    },
    badgeLocal: {
        position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.7)',
        borderRadius: radius, paddingHorizontal: 6, paddingVertical: 2,
    },
    badgeAlert: {
        position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.7)',
        borderRadius: radius, paddingHorizontal: 6, paddingVertical: 2,
    },
    badgeAlertActive: { backgroundColor: colors.accent },
    badgeText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 9 },
    pager: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border,
    },
    pagerBtn: { backgroundColor: colors.bgHover, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    pagerBtnDisabled: { opacity: 0.4 },
    pagerBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    pagerLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
})
