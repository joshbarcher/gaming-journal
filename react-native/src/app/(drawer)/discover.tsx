import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { getFeatured, getFeaturedPage, getOwnership, searchGamesPaged } from '@/api/discover'
import { getSettings } from '@/api/settings'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { getCachedBlocklist, setCachedBlocklist } from '@/storage/discBlocklist'
import { getWithTTL, setWithTTL } from '@/storage/ttl'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { FEATURED_TABS, type DiscoverFeaturedItem, type DiscoverSection } from 'gaming-journal-contracts/discoverFeatured'
import type { DiscoverItem } from 'gaming-journal-contracts/discoverSearch'

const SEARCH_PAGE_SIZE = 40
const STORAGE_KEY = 'disc-state'

type Mode = 'browse' | 'search'
type CardItem = (DiscoverFeaturedItem | DiscoverItem) & { price?: number | null; originalPrice?: number | null; discount?: number; isFree?: boolean }

// Port of Discover.svelte — browse Steam's featured sections or search the full catalog, with
// ownership/wishlist badges. Read the real source directly for the exact state machine (mode
// switch on search input, per-tab page cache, search-results-per-page cache).
//
// **Title blocklist now wired up** (Settings item, Phase 6) — was deliberately deferred as dead
// code when this screen was first built ("a blocklist that can never be populated would be dead
// code"). Ported verbatim: read the AsyncStorage mirror (`disc-title-blocklist`, the RN
// equivalent of the web's `localStorage` key of the same name) first for an instant initial
// filter state, THEN fetch the authoritative `/api/settings` and re-mirror whatever it returns —
// same two-step "cached-then-authoritative" sequence as the real `onMount`, not just a single
// fetch.
// **Keyboard arrow-key pagination/scroll-by-page dropped** — no keyboard on touch, same category
// of adaptation as every other dropped keyboard shortcut this session.
export default function DiscoverScreen() {
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const breakpoint = useBreakpoint()
    // Real, distinct breakpoints for THIS grid (confirmed via discover.css, not assumed to match
    // Library's 2/3/3): 2 cols ≤799px, 3 cols 800–1279px — narrower than Library's own 2/3/3 split.
    const numColumns = breakpoint === 'tabletLandscape' ? 3 : 2
    const shortTabLabels = breakpoint === 'mobilePortrait'

    const [mode, setMode] = useState<Mode>('browse')
    const [featuredTab, setFeaturedTab] = useState('new_releases')
    const [searchQuery, setSearchQuery] = useState('')
    const [featuredData, setFeaturedData] = useState<DiscoverSection[]>([])
    const [tabPages, setTabPages] = useState<Record<string, number>>({})
    const [owned, setOwned] = useState<Set<number>>(new Set())
    const [wishlist, setWishlist] = useState<Set<number>>(new Set())
    const [titleBlocklist, setTitleBlocklist] = useState<string[]>([])
    const [discoverFiltersEnabled, setDiscoverFiltersEnabled] = useState(true)

    const [searchResults, setSearchResults] = useState<DiscoverItem[]>([])
    const [searchTotal, setSearchTotal] = useState(0)
    const [searchPage, setSearchPage] = useState(1)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchError, setSearchError] = useState<string | null>(null)

    const [featuredLoading, setFeaturedLoading] = useState(false)
    const [featuredError, setFeaturedError] = useState<string | null>(null)

    const searchCacheRef = useRef<Map<number, DiscoverItem[]>>(new Map())
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const restoredRef = useRef(false)

    const activeSection = featuredData.find(s => s.id === featuredTab) ?? null
    const searchPages = searchTotal > 0 ? Math.ceil(searchTotal / SEARCH_PAGE_SIZE) : 1

    function saveState(next: Partial<{ mode: Mode; tab: string; tabPages: Record<string, number>; searchQuery: string; searchTotal: number; searchPage: number; searchResults: DiscoverItem[] }>) {
        setWithTTL(STORAGE_KEY, {
            mode: next.mode ?? mode, tab: next.tab ?? featuredTab, tabPages: next.tabPages ?? tabPages,
            searchQuery: next.searchQuery ?? searchQuery, searchTotal: next.searchTotal ?? searchTotal, searchPage: next.searchPage ?? searchPage,
            // Ported from Discover.svelte's `_lastResults` — the actual result array is persisted
            // too (not just the query/page metadata), so returning to the screen after being in
            // search mode restores the exact same results instantly, no re-fetch. Found missing
            // during the Phase 6 gotcha cross-check pass.
            searchResults: next.searchResults ?? searchResults,
        })
    }

    async function loadOwnership() {
        try {
            const entries = await getOwnership()
            const o = new Set<number>(), w = new Set<number>()
            for (const g of entries) {
                if (g.source === 'library' || g.source === 'both') o.add(g.appid)
                if (g.source === 'wishlist' || g.source === 'both') w.add(g.appid)
            }
            setOwned(o)
            setWishlist(w)
        } catch { /* non-critical, matching the web's own silent catch */ }
    }

    async function loadFeatured() {
        setFeaturedLoading(true)
        setFeaturedError(null)
        try {
            const sections = await getFeatured()
            setFeaturedData(sections)
            setTabPages(prev => {
                const next = { ...prev }
                for (const s of sections) if (!next[s.id]) next[s.id] = 1
                return next
            })
        } catch {
            setFeaturedError('Failed to load featured games.')
        } finally {
            setFeaturedLoading(false)
        }
    }

    async function loadFeaturedPage(tab: string, page: number) {
        setFeaturedLoading(true)
        setFeaturedError(null)
        try {
            const section = await getFeaturedPage(tab, page)
            setFeaturedData(prev => {
                const idx = prev.findIndex(s => s.id === tab)
                if (idx === -1) return prev
                const next = [...prev]
                next[idx] = section
                return next
            })
            setTabPages(prev => {
                const next = { ...prev, [tab]: section.page }
                saveState({ tabPages: next })
                return next
            })
        } catch {
            setFeaturedError(`Failed to load page ${page}.`)
        } finally {
            setFeaturedLoading(false)
        }
    }

    function switchTab(tab: string) {
        setFeaturedTab(tab)
        saveState({ tab })
        const existing = featuredData.find(s => s.id === tab)
        if (!existing) loadFeaturedPage(tab, tabPages[tab] ?? 1)
    }

    async function doSearch(q: string) {
        if (!q.trim()) return
        setSearchPage(1)
        setSearchTotal(0)
        searchCacheRef.current = new Map()
        setSearchLoading(true)
        setSearchError(null)
        try {
            const data = await searchGamesPaged(q.trim(), SEARCH_PAGE_SIZE, 0)
            searchCacheRef.current.set(1, data.results)
            setSearchTotal(data.total ?? 0)
            setSearchResults(data.results)
            saveState({ mode: 'search', searchQuery: q, searchTotal: data.total ?? 0, searchPage: 1, searchResults: data.results })
        } catch (err) {
            setSearchError(`Search unavailable: ${(err as Error).message}`)
        } finally {
            setSearchLoading(false)
        }
    }

    async function goSearchPage(dir: number) {
        const page = searchPage + dir
        const cached = searchCacheRef.current.get(page)
        if (cached) {
            setSearchPage(page)
            setSearchResults(cached)
            saveState({ searchPage: page, searchResults: cached })
            return
        }
        setSearchLoading(true)
        setSearchError(null)
        try {
            const offset = (page - 1) * SEARCH_PAGE_SIZE
            const data = await searchGamesPaged(searchQuery, SEARCH_PAGE_SIZE, offset)
            searchCacheRef.current.set(page, data.results)
            setSearchTotal(data.total ?? 0)
            setSearchPage(page)
            setSearchResults(data.results)
            saveState({ searchPage: page, searchResults: data.results })
        } catch (err) {
            setSearchError(`Failed to load page ${page}: ${(err as Error).message}`)
        } finally {
            setSearchLoading(false)
        }
    }

    function onSearchChange(text: string) {
        setSearchQuery(text)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        if (text.trim()) {
            setMode('search')
            debounceRef.current = setTimeout(() => doSearch(text), 350)
        } else {
            setMode('browse')
            setSearchTotal(0)
            setSearchPage(1)
            setSearchResults([])
            searchCacheRef.current = new Map()
            saveState({ mode: 'browse', searchQuery: '', searchTotal: 0, searchPage: 1, searchResults: [] })
        }
    }

    useEffect(() => {
        loadOwnership()
        getCachedBlocklist().then(setTitleBlocklist)
        getSettings().then(s => {
            setTitleBlocklist(s.titleBlocklist ?? [])
            setDiscoverFiltersEnabled(s.discoverFiltersEnabled ?? true)
            setCachedBlocklist(s.titleBlocklist ?? [])
        }).catch(() => {})
        ;(async () => {
            const saved = await getWithTTL<{
                mode: Mode; tab: string; tabPages: Record<string, number>
                searchQuery: string; searchTotal: number; searchPage: number; searchResults?: DiscoverItem[]
            }>(STORAGE_KEY)
            if (saved) {
                if (saved.tab) setFeaturedTab(saved.tab)
                if (saved.tabPages) setTabPages(saved.tabPages)
            }
            restoredRef.current = true
            // Ported from Discover.svelte's onMount: if search mode was saved WITH real cached
            // results, restore them directly (seed the page cache, skip loadFeatured entirely) —
            // otherwise force browse mode and load featured. Previously this branch didn't exist
            // at all (only tab/tabPages were restored), so returning to the screen after a search
            // always silently reverted to Browse — found by the Phase 6 gotcha cross-check pass.
            if (saved?.mode === 'search' && saved.searchResults?.length) {
                setSearchQuery(saved.searchQuery)
                setSearchTotal(saved.searchTotal)
                setSearchPage(saved.searchPage)
                setSearchResults(saved.searchResults)
                searchCacheRef.current = new Map([[saved.searchPage, saved.searchResults]])
                setMode('search')
            } else {
                setMode('browse')
                await loadFeatured()
            }
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once, matching the web's own onMount
    }, [])

    function badgeFor(appid: number): 'owned' | 'wish' | null {
        if (owned.has(appid)) return 'owned'
        if (wishlist.has(appid)) return 'wish'
        return null
    }

    const rawItems: CardItem[] = mode === 'browse' ? (activeSection?.items ?? []) : searchResults
    // Ported verbatim from Discover.svelte's visibleBrowseItems/visibleSearchResults — identical
    // filter applied to both modes, gated by discoverFiltersEnabled and a non-empty blocklist.
    const items = titleBlocklist.length && discoverFiltersEnabled
        ? rawItems.filter(item => !titleBlocklist.some(t => item.name.toLowerCase().includes(t)))
        : rawItems
    const loading = mode === 'browse' ? featuredLoading : searchLoading
    const errorMsg = mode === 'browse' ? featuredError : searchError
    const page = mode === 'browse' ? (activeSection?.page ?? 1) : searchPage
    const pages = mode === 'browse' ? (activeSection?.pages ?? 1) : searchPages

    function goPage(dir: number) {
        if (mode === 'browse') loadFeaturedPage(featuredTab, page + dir)
        else goSearchPage(dir)
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Discover</Text>
            <TextInput
                style={styles.search}
                placeholder="Search 160,000+ Steam games…"
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={onSearchChange}
                autoCapitalize="none"
                autoCorrect={false}
            />

            {mode === 'browse' && (
                <View style={styles.tabsBar}>
                    {FEATURED_TABS.map(t => (
                        <Pressable key={t.id} style={[styles.tab, featuredTab === t.id && styles.tabActive]} onPress={() => switchTab(t.id)}>
                            <Text style={[styles.tabText, featuredTab === t.id && styles.tabTextActive]}>{shortTabLabels ? t.short : t.label}</Text>
                        </Pressable>
                    ))}
                </View>
            )}

            {mode === 'search' && !searchLoading && searchTotal > 0 && (
                <Text style={styles.resultCount}>{searchTotal.toLocaleString()} result{searchTotal !== 1 ? 's' : ''}</Text>
            )}

            {loading ? (
                <Text style={styles.stateText}>{mode === 'browse' ? 'Loading…' : 'Searching…'}</Text>
            ) : errorMsg ? (
                <Text style={[styles.stateText, styles.errorText]}>{errorMsg}</Text>
            ) : items.length === 0 ? (
                <Text style={styles.stateText}>{mode === 'search' ? `No results for "${searchQuery}".` : 'No results yet — check back soon.'}</Text>
            ) : (
                <FlatList
                    key={numColumns}
                    data={items}
                    keyExtractor={(item) => String(item.appid)}
                    numColumns={numColumns}
                    contentContainerStyle={styles.grid}
                    columnWrapperStyle={styles.gridRow}
                    renderItem={({ item }) => (
                        <DiscoverCard item={item} apiHost={apiHost} numColumns={numColumns} badge={badgeFor(item.appid)} isSearch={mode === 'search'} />
                    )}
                    ListFooterComponent={pages > 1 ? (
                        <View style={styles.pagination}>
                            <Pressable style={styles.pageBtn} disabled={page <= 1} onPress={() => goPage(-1)}>
                                <Text style={[styles.pageBtnText, page <= 1 && styles.pageBtnTextDisabled]}>← Prev</Text>
                            </Pressable>
                            <Text style={styles.pageInfo}>Page {page} of {pages}</Text>
                            <Pressable style={styles.pageBtn} disabled={page >= pages} onPress={() => goPage(1)}>
                                <Text style={[styles.pageBtnText, page >= pages && styles.pageBtnTextDisabled]}>Next →</Text>
                            </Pressable>
                        </View>
                    ) : null}
                />
            )}
        </View>
    )
}

function DiscoverCard({ item, apiHost, numColumns, badge, isSearch }: {
    item: CardItem
    apiHost: string | undefined
    numColumns: number
    badge: 'owned' | 'wish' | null
    isSearch: boolean
}) {
    // **Real, confirmed URL-convention difference**: search results' `headerImage` is already an
    // absolute steamstatic CDN URL; featured items' `headerImage` is relay-relative and needs the
    // apiHost prefix — verified live for both, not assumed the two endpoints agree.
    const imgUri = isSearch ? item.headerImage : (apiHost ? `${apiHost}${item.headerImage}` : undefined)
    const cardStyle = StyleSheet.flatten([styles.card, { flex: 1 / numColumns }])
    return (
        <Pressable style={cardStyle} onPress={() => router.push(`/game/${item.appid}` as never)}>
            <View style={styles.cardImgWrap}>
                {!!imgUri && <Image source={{ uri: imgUri }} style={styles.cardImg} contentFit="cover" cachePolicy="memory-disk" recyclingKey={String(item.appid)} />}
                {!!badge && (
                    <View style={[styles.badge, badge === 'owned' ? styles.badgeOwned : styles.badgeWish]}>
                        <Text style={styles.badgeText}>{badge === 'owned' ? 'Owned' : 'Wishlisted'}</Text>
                    </View>
                )}
            </View>
            <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
            <View style={styles.priceRow}>
                {item.isFree ? (
                    <Text style={styles.priceFree}>Free</Text>
                ) : item.price != null ? (
                    (item.discount ?? 0) > 0 && item.originalPrice != null ? (
                        <>
                            <Text style={styles.discount}>-{item.discount}%</Text>
                            <Text style={styles.priceWas}>${item.originalPrice.toFixed(2)}</Text>
                            <Text style={styles.price}>${item.price.toFixed(2)}</Text>
                        </>
                    ) : (
                        <Text style={styles.price}>${item.price.toFixed(2)}</Text>
                    )
                ) : null}
            </View>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22, marginBottom: spacing.md },
    search: { color: colors.text, fontFamily: fonts.ui, fontSize: 14, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
    tabsBar: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
    tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius, backgroundColor: colors.bgHover },
    tabActive: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    tabText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    tabTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    resultCount: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginBottom: spacing.sm },
    stateText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, textAlign: 'center', paddingVertical: spacing.xl },
    errorText: { color: '#fca5a5' },
    grid: { gap: spacing.sm, paddingBottom: spacing.xl },
    gridRow: { gap: spacing.sm },
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: 'hidden', marginBottom: spacing.sm },
    cardImgWrap: { position: 'relative', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    cardImg: { width: '100%', height: '100%' },
    badge: { position: 'absolute', top: 4, right: 4, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },
    badgeOwned: { backgroundColor: 'rgba(80,200,100,0.85)' },
    badgeWish: { backgroundColor: 'rgba(201,168,76,0.85)' },
    badgeText: { color: '#131210', fontFamily: fonts.uiBold, fontSize: 9 },
    cardName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 11, padding: spacing.xs, paddingBottom: 2 },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs, minHeight: 16 },
    priceFree: { color: '#50c864', fontFamily: fonts.uiBold, fontSize: 11 },
    price: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 11 },
    priceWas: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, textDecorationLine: 'line-through' },
    discount: { color: '#50c864', fontFamily: fonts.uiBold, fontSize: 10 },
    pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.md },
    pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: 6 },
    pageBtnText: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    pageBtnTextDisabled: { color: colors.textMuted, opacity: 0.4 },
    pageInfo: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
})
