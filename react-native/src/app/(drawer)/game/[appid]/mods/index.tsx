import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    ActivityIndicator, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'

import {
    getDeep, getModsPage, getNexusData, startDeepPull,
    type NexusDeep, type NexusModFull,
} from '@/api/nexus'
import { getSettings } from '@/api/settings'
import { ModCard } from '@/components/game/NexusMods'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// Port of ModsPage.svelte — the full mods list: debounced search, 6 sorts, the 3-state adult filter
// (No 18+ / All / Only 18+), and "deep search" (a full-catalogue crawl the client then filters/sorts
// locally, with category + tag facets). Live mode paginates server-side (offset/limit) with
// infinite scroll; deep mode grows a client-side visible window. Web <select>s become touch-friendly
// horizontal pill rows; the web's IntersectionObserver sentinel becomes FlatList onEndReached.
type AdultMode = 'hide' | 'all' | 'only'
const LIMIT = 24
const SORTS: { key: string; label: string }[] = [
    { key: 'endorsements', label: 'Most Endorsed' },
    { key: 'downloads',    label: 'Most Downloaded' },
    { key: 'updated',      label: 'Recently Updated' },
    { key: 'added',        label: 'Newest' },
    { key: 'name',         label: 'Name (A–Z)' },
    { key: 'size',         label: 'Largest' },
]

function sortMods(arr: NexusModFull[], key: string): NexusModFull[] {
    const c = [...arr]
    switch (key) {
        case 'downloads': return c.sort((a, b) => b.downloads - a.downloads)
        case 'updated':   return c.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        case 'added':     return c.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        case 'name':      return c.sort((a, b) => a.name.localeCompare(b.name))
        case 'size':      return c.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0))
        default:          return c.sort((a, b) => b.endorsements - a.endorsements)
    }
}

export default function ModsListScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const apiHost = useApiHost().data

    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const hideAdult = settingsQuery.data?.hideAdultContent ?? true

    // Reuse the cached section entry (already primed by the game page) for the game name + the
    // "not on Nexus" state, matching ModsPage.svelte's loadMeta().
    const metaQuery = useQuery({ queryKey: ['nexus', appid], queryFn: () => getNexusData(appid) })
    const gameName = metaQuery.data?.steamName ?? metaQuery.data?.nexusName ?? 'Game'

    const [sort, setSort] = useState('endorsements')
    const [query, setQuery] = useState('')
    const [activeQ, setActiveQ] = useState('')
    const [deep, setDeep] = useState(false)
    const [adultMode, setAdultMode] = useState<AdultMode>('all')
    const [notOnNexus, setNotOnNexus] = useState(false)

    // Live (server-paginated) mode.
    const [mods, setMods] = useState<NexusModFull[]>([])
    const [totalCount, setTotalCount] = useState(0)
    const [liveLoading, setLiveLoading] = useState(false)
    const [liveError, setLiveError] = useState(false)
    const offsetRef = useRef(0)
    const doneRef = useRef(false)
    const loadingRef = useRef(false)

    // Deep (client-side over the full pulled set) mode.
    const [deepData, setDeepData] = useState<NexusDeep | null>(null)
    const [category, setCategory] = useState('')
    const [tag, setTag] = useState('')
    const [visibleCount, setVisibleCount] = useState(LIMIT)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const deepStartedRef = useRef(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Mirror the control values into refs so the async loaders/pollers never read a stale closure.
    const sortRef = useRef(sort)
    const activeQRef = useRef(activeQ)
    const adultRef = useRef(adultMode)
    const deepRef = useRef(deep)
    useEffect(() => { sortRef.current = sort }, [sort])
    useEffect(() => { activeQRef.current = activeQ }, [activeQ])
    useEffect(() => { adultRef.current = adultMode }, [adultMode])
    useEffect(() => { deepRef.current = deep }, [deep])

    const loadPage = useCallback(async (reset: boolean) => {
        if (deepRef.current || loadingRef.current) return
        if (reset) { offsetRef.current = 0; doneRef.current = false; setLiveError(false) }
        else if (doneRef.current) return
        loadingRef.current = true
        setLiveLoading(true)
        try {
            const page = await getModsPage(appid, {
                sort: sortRef.current, offset: offsetRef.current, limit: LIMIT,
                q: activeQRef.current, adult: adultRef.current,
            })
            setNotOnNexus(page.domainName == null)
            setTotalCount(page.totalCount)
            setMods(prev => {
                const next = reset ? page.mods : [...prev, ...page.mods]
                offsetRef.current = next.length
                if (page.mods.length < LIMIT || next.length >= page.totalCount) doneRef.current = true
                return next
            })
        } catch {
            setLiveError(true); doneRef.current = true
        } finally {
            loadingRef.current = false; setLiveLoading(false)
        }
    }, [appid])

    // ── Deep pull: start + poll ──────────────────────────────────────────────────────────────────
    const stopPolling = useCallback(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }, [])
    const pollDeep = useCallback(async () => {
        try {
            const d = await getDeep(appid)
            setDeepData(d)
            if (d.status === 'done' || d.status === 'error') stopPolling()
        } catch { /* keep last snapshot */ }
    }, [appid, stopPolling])
    const startDeep = useCallback(async () => {
        setDeepData(prev => prev ?? { appid, status: 'running', pulled: 0, total: 0, capped: false, mods: [] })
        await startDeepPull(appid)
        await pollDeep()
        if (!pollRef.current) pollRef.current = setInterval(pollDeep, 1500)
    }, [appid, pollDeep])

    function toggleDeep() {
        const next = !deep
        deepRef.current = next
        setDeep(next)
        setVisibleCount(LIMIT)
        if (next) {
            if (!deepStartedRef.current) { deepStartedRef.current = true; startDeep() }
            else { pollDeep(); if (!pollRef.current) pollRef.current = setInterval(pollDeep, 1500) }
        } else {
            stopPolling()
        }
    }

    // Controls: reset the visible window (deep) or reload from the server (live).
    function afterControlChange() {
        setVisibleCount(LIMIT)
        if (!deepRef.current) loadPage(true)
    }
    function onSortChange(key: string) { sortRef.current = key; setSort(key); afterControlChange() }
    function setAdult(mode: AdultMode) { adultRef.current = mode; setAdultMode(mode); afterControlChange() }
    function onSearchInput(text: string) {
        setQuery(text)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            const trimmed = text.trim()
            activeQRef.current = trimmed
            setActiveQ(trimmed)
            afterControlChange()
        }, deepRef.current ? 120 : 350)
    }

    useEffect(() => {
        loadPage(true)
        return () => { stopPolling(); if (debounceRef.current) clearTimeout(debounceRef.current) }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once, matching the web's onMount
    }, [])

    // ── Deep derived data (client-side filter + sort over the full pulled set) ────────────────────
    const deepMods = deepData?.mods ?? []
    const deepStatus = deepData?.status ?? 'idle'
    const deepCapped = deepData?.capped ?? false
    const categories = useMemo(
        () => [...new Set(deepMods.map(m => m.category).filter(Boolean))].sort() as string[],
        [deepMods],
    )
    const tagOptions = useMemo(() => {
        const counts = new Map<string, number>()
        for (const m of deepMods) for (const t of (m.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1)
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    }, [deepMods])
    const deepFiltered = useMemo(() => {
        let arr = deepMods
        const q = activeQ.toLowerCase()
        if (q)        arr = arr.filter(m => m.name.toLowerCase().includes(q))
        if (category) arr = arr.filter(m => m.category === category)
        if (tag)      arr = arr.filter(m => m.tags?.includes(tag))
        if (adultMode === 'hide')      arr = arr.filter(m => !m.adult)
        else if (adultMode === 'only') arr = arr.filter(m => m.adult)
        return sortMods(arr, sort)
    }, [deepMods, activeQ, category, tag, adultMode, sort])
    const deepVisible = useMemo(() => deepFiltered.slice(0, visibleCount), [deepFiltered, visibleCount])

    const shown = deep ? deepVisible : mods
    const headerCount = deep ? deepFiltered.length : totalCount

    function onEndReached() {
        if (deep) { if (visibleCount < deepFiltered.length) setVisibleCount(v => v + LIMIT) }
        else loadPage(false)
    }

    const deepBar = (() => {
        if (!deep) return null
        if (deepStatus === 'running') {
            return `Deep search — pulled ${(deepData?.pulled ?? 0).toLocaleString()}${deepData?.total ? ` of ${deepData.total.toLocaleString()}` : ''}…`
        }
        if (deepCapped) {
            return `⚠ Reached the ${deepMods.length.toLocaleString()}-mod deep limit — this game has ${(deepData?.total ?? 0).toLocaleString()} mods. Sorted by endorsements; refine with search & filters.`
        }
        if (deepStatus === 'done') return `✓ Pulled all ${deepMods.length.toLocaleString()} mods — search & filter the full set below.`
        if (deepStatus === 'error') return `Couldn't complete the deep pull. Showing ${deepMods.length.toLocaleString()} pulled so far.`
        return null
    })()

    const header = (
        <View>
            <View style={styles.breadcrumb}>
                <Pressable onPress={() => router.push(`/game/${appid}` as never)} hitSlop={6}>
                    <Text style={styles.crumb}>‹ {gameName}</Text>
                </Pressable>
            </View>
            <View style={styles.titleRow}>
                <Text style={styles.title}>Mods</Text>
                {headerCount > 0 && <Text style={styles.count}>{headerCount.toLocaleString()}</Text>}
            </View>

            <TextInput
                style={styles.search}
                placeholder={deep ? 'Search all pulled mods…' : 'Search mods…'}
                placeholderTextColor={colors.textMuted}
                value={query}
                onChangeText={onSearchInput}
                autoCapitalize="none"
                autoCorrect={false}
            />

            <PillRow>
                {SORTS.map(s => (
                    <Pill key={s.key} label={s.label} active={sort === s.key} onPress={() => onSortChange(s.key)} />
                ))}
            </PillRow>

            {deep && categories.length > 0 && (
                <PillRow>
                    <Pill label="All categories" active={category === ''} onPress={() => { setCategory(''); setVisibleCount(LIMIT) }} />
                    {categories.map(c => (
                        <Pill key={c} label={c} active={category === c} onPress={() => { setCategory(c); setVisibleCount(LIMIT) }} />
                    ))}
                </PillRow>
            )}
            {deep && tagOptions.length > 0 && (
                <PillRow>
                    <Pill label="All tags" active={tag === ''} onPress={() => { setTag(''); setVisibleCount(LIMIT) }} />
                    {tagOptions.map(([t, n]) => (
                        <Pill key={t} label={`${t} (${n})`} active={tag === t} onPress={() => { setTag(t); setVisibleCount(LIMIT) }} />
                    ))}
                </PillRow>
            )}

            <View style={styles.controlsRow}>
                <View style={styles.segment}>
                    <SegBtn label="No 18+" active={adultMode === 'hide'} onPress={() => setAdult('hide')} />
                    <SegBtn label="All" active={adultMode === 'all'} onPress={() => setAdult('all')} />
                    <SegBtn label="Only 18+" active={adultMode === 'only'} onPress={() => setAdult('only')} />
                </View>
                <Pressable style={[styles.deepBtn, deep && styles.deepBtnOn]} onPress={toggleDeep}>
                    <Text style={[styles.deepBtnText, deep && styles.deepBtnTextOn]}>{deep ? '● Deep search' : 'Deep search'}</Text>
                </Pressable>
            </View>

            {!!deepBar && (
                <View style={[styles.deepBar, deepCapped && styles.deepBarCapped]}>
                    {deepStatus === 'running' && <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: spacing.xs }} />}
                    <Text style={styles.deepBarText}>{deepBar}</Text>
                </View>
            )}

            {notOnNexus ? (
                <Text style={styles.empty}>This game isn't on Nexus Mods.</Text>
            ) : !deep && liveError && mods.length === 0 ? (
                <Text style={styles.empty}>Couldn't load mods. Try again later.</Text>
            ) : shown.length === 0 && activeQ ? (
                <Text style={styles.empty}>No mods match "{activeQ}".</Text>
            ) : null}
        </View>
    )

    return (
        <View style={styles.container}>
            <FlatList
                data={shown}
                keyExtractor={(m) => String(m.modId)}
                numColumns={2}
                columnWrapperStyle={styles.gridRow}
                contentContainerStyle={styles.grid}
                ListHeaderComponent={header}
                keyboardShouldPersistTaps="handled"
                onEndReached={onEndReached}
                onEndReachedThreshold={0.6}
                renderItem={({ item }) => (
                    <ModCard
                        mod={item}
                        apiHost={apiHost}
                        hideAdult={hideAdult}
                        showSize
                        onPress={() => router.push(`/game/${appid}/mods/${item.modId}` as never)}
                        onExternal={() => Linking.openURL(item.url)}
                    />
                )}
                ListFooterComponent={
                    (!deep && liveLoading) || (deep && deepStatus === 'running')
                        ? <View style={styles.footerLoad}><ActivityIndicator color={colors.accent} /></View>
                        : null
                }
            />
        </View>
    )
}

function PillRow({ children }: { children: React.ReactNode }) {
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {children}
        </ScrollView>
    )
}
function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
        <Pressable style={[styles.pill, active && styles.pillActive]} onPress={onPress}>
            <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>{label}</Text>
        </Pressable>
    )
}
function SegBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
        <Pressable style={[styles.segBtn, active && styles.segBtnActive]} onPress={onPress}>
            <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>{label}</Text>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    grid: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
    gridRow: { gap: spacing.sm, justifyContent: 'space-between' },
    breadcrumb: { marginBottom: spacing.xs },
    crumb: { color: colors.accent, fontFamily: fonts.ui, fontSize: 13 },
    titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    count: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 14 },
    search: {
        color: colors.text, fontFamily: fonts.ui, fontSize: 14, backgroundColor: colors.bgRaised,
        borderWidth: 1, borderColor: colors.border, borderRadius: radius,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm,
    },
    pillRow: { gap: spacing.xs, paddingBottom: spacing.sm },
    pill: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.bgHover },
    pillActive: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    pillText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    pillTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    controlsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
    segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: 'hidden' },
    segBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.bgRaised },
    segBtnActive: { backgroundColor: colors.accentBg },
    segBtnText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    segBtnTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    deepBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised },
    deepBtnOn: { borderColor: colors.borderAct, backgroundColor: colors.accentBg },
    deepBtnText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 12 },
    deepBtnTextOn: { color: colors.accent },
    deepBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgRaised, borderRadius: radius, padding: spacing.sm, marginBottom: spacing.sm },
    deepBarCapped: { borderWidth: 1, borderColor: '#e0a33a' },
    deepBarText: { color: colors.text, fontFamily: fonts.ui, fontSize: 12, flex: 1, lineHeight: 17 },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, textAlign: 'center', paddingVertical: spacing.xl },
    footerLoad: { paddingVertical: spacing.lg },
})
