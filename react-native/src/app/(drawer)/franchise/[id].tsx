import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link, router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import {
    addFranchiseEntry, deleteFranchise, getFranchise, reorderFranchiseEntries,
    removeFranchiseEntry, updateFranchiseName,
} from '@/api/franchises'
import { getFlags } from '@/api/flags'
import { getRelayGames } from '@/api/relayGames'
import { getSettings } from '@/api/settings'
import { confirmDialog } from '@/store/confirmDialogStore'
import { DraggableList, type DraggableListRenderItem } from '@/components/shared/DraggableList'
import { HeroCrossfade } from '@/components/shared/HeroCrossfade'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { makeShouldShow } from '@/utils/gameFilter'
import type { Franchise, FranchiseEntry } from 'gaming-journal-contracts/franchises'
import type { RelayGame } from 'gaming-journal-contracts/relayGames'

// Port of collections/franchises.md's detail page (Franchise.svelte). Read the source directly —
// it derives entry status from flags+ownership at render time (no stored status field), and its
// hero/timeline/search logic doesn't match the doc's prose closely enough to trust alone.
function fmtHours(mins: number | null | undefined): string | null {
    if (!mins) return null
    const h = mins / 60
    if (h < 1) return `${Math.round(mins)}m`
    if (h < 10) return `${h.toFixed(1)}h`
    return `${Math.round(h)}h`
}

const STATUS_LABELS: Record<string, string | null> = {
    completed: 'Completed', dropped: 'Dropped', 'in-progress': 'In Progress',
    playing: 'Playing', wishlist: 'Wishlisted', unplayed: null,
}

const TIMELINE_FILL: Record<string, { pct: number; color: string }> = {
    completed:     { pct: 100, color: '#4caf72' },
    dropped:       { pct: 100, color: '#e05252' },
    'in-progress': { pct: 55,  color: '#e0a052' },
    playing:       { pct: 30,  color: '#c9913d' },
    wishlist:      { pct: 0,   color: 'transparent' },
    unplayed:      { pct: 0,   color: 'transparent' },
}

export default function FranchiseDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const franchiseId = id!
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const breakpoint = useBreakpoint()
    const queryClient = useQueryClient()

    const franchiseQuery = useQuery({ queryKey: ['franchise', franchiseId], queryFn: () => getFranchise(franchiseId) })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const relayGamesQuery = useQuery({ queryKey: ['relayGames'], queryFn: getRelayGames })

    const [titleDraft, setTitleDraft] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchFocused, setSearchFocused] = useState(false)
    const renameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    function setFranchiseCache(updated: Franchise) {
        queryClient.setQueryData(['franchise', franchiseId], updated)
    }

    const renameMutation = useMutation({
        mutationFn: (name: string) => updateFranchiseName(franchiseId, name),
        onSuccess: setFranchiseCache,
    })
    const addEntryMutation = useMutation({
        mutationFn: (entry: { appid: number; name: string }) => addFranchiseEntry(franchiseId, entry),
        onSuccess: (updated) => { setFranchiseCache(updated); setSearchQuery(''); setSearchFocused(false) },
    })
    const removeEntryMutation = useMutation({
        mutationFn: (appid: number) => removeFranchiseEntry(franchiseId, appid),
        onSuccess: setFranchiseCache,
    })
    const reorderMutation = useMutation({
        mutationFn: (appids: number[]) => reorderFranchiseEntries(franchiseId, appids),
        onSuccess: setFranchiseCache,
    })
    const deleteMutation = useMutation({
        mutationFn: () => deleteFranchise(franchiseId),
        onSuccess: () => router.replace('/franchises' as never),
    })

    useEffect(() => () => { if (renameTimer.current) clearTimeout(renameTimer.current) }, [])

    const franchise = franchiseQuery.data
    const flags = flagsQuery.data ?? {}

    const { ownedMap, wishlistMap } = useMemo(() => {
        const owned = new Map<number, RelayGame>()
        const wishlist = new Map<number, RelayGame>()
        for (const g of relayGamesQuery.data ?? []) {
            if (g.source !== 'wishlist') owned.set(g.appid, g)
            if (g.source === 'wishlist' || g.source === 'both') wishlist.set(g.appid, g)
        }
        return { ownedMap: owned, wishlistMap: wishlist }
    }, [relayGamesQuery.data])

    function deriveStatus(appid: number): string {
        const f = flags[appid]
        const owned = ownedMap.get(appid)
        const wl = wishlistMap.get(appid)
        const playtime = owned?.playtimeMinutes ?? 0
        if (f?.completed) return 'completed'
        if (f?.dropped) return 'dropped'
        if (f?.inProgress) return 'in-progress'
        if (playtime > 0) return 'playing'
        if (wl && !owned) return 'wishlist'
        return 'unplayed'
    }

    // Parity with Franchise.svelte: entries run through shouldShow so childLock/filtered/software
    // games are removed from the entry list, timeline, and stats (was unfiltered on native).
    const shouldShow = useMemo(() => makeShouldShow(flags, settingsQuery.data ?? {}), [flags, settingsQuery.data])
    const entries = useMemo(() => (franchise?.entries ?? []).filter(e => shouldShow(e.appid)), [franchise?.entries, shouldShow])

    const timelineEntries = useMemo(() => entries.map(e => {
        const status = deriveStatus(e.appid)
        return { ...e, status, fill: TIMELINE_FILL[status] ?? TIMELINE_FILL.unplayed, statusLabel: STATUS_LABELS[status] ?? 'Unplayed' }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deriveStatus closes over flags/ownedMap/wishlistMap, already deps below
    }), [entries, flags, ownedMap, wishlistMap])

    const stats = useMemo(() => {
        let completed = 0, dropped = 0, inProgress = 0, playing = 0, totalMins = 0
        for (const e of entries) {
            totalMins += ownedMap.get(e.appid)?.playtimeMinutes ?? 0
            const s = deriveStatus(e.appid)
            if (s === 'completed') completed++
            else if (s === 'dropped') dropped++
            else if (s === 'in-progress') inProgress++
            else if (s === 'playing') playing++
        }
        return { completed, dropped, inProgress, playing, totalMins, total: entries.length }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entries, flags, ownedMap, wishlistMap])

    const completedCount = timelineEntries.filter(e => e.status === 'completed').length
    const timelinePct = entries.length ? Math.round((completedCount / entries.length) * 100) : 0

    const heroFrames = useMemo(() => {
        if (!apiHost || entries.length === 0) return []
        const urls: string[] = []
        for (const e of entries) {
            const shots = ownedMap.get(e.appid)?.media?.screenshots ?? []
            if (shots.length > 0) urls.push(...shots.map(p => `${apiHost}${p}`))
            else urls.push(`${apiHost}/relay/images/steam/games/${e.appid}/header.jpg`)
        }
        return [...urls].sort(() => Math.random() - 0.5)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only reshuffle when the entry set genuinely changes, matching the web's $effect(entries)
    }, [entries, apiHost])

    const searchResults = useMemo(() => {
        const q = searchQuery.trim().toLowerCase()
        if (q.length < 2) return []
        const existing = new Set(entries.map(e => e.appid))
        const results: { appid: number; name: string; tag: 'owned' | 'wishlist' }[] = []
        for (const [appid, g] of ownedMap) {
            if (existing.has(appid)) continue
            if (g.name.toLowerCase().includes(q)) results.push({ appid, name: g.name, tag: 'owned' })
        }
        for (const [appid, g] of wishlistMap) {
            if (existing.has(appid) || ownedMap.has(appid)) continue
            if (g.name.toLowerCase().includes(q)) results.push({ appid, name: g.name, tag: 'wishlist' })
        }
        results.sort((a, b) => {
            const ai = a.name.toLowerCase().indexOf(q)
            const bi = b.name.toLowerCase().indexOf(q)
            return ai !== bi ? ai - bi : a.name.localeCompare(b.name)
        })
        return results.slice(0, 30)
    }, [searchQuery, entries, ownedMap, wishlistMap])

    const isLoading = franchiseQuery.isLoading || flagsQuery.isLoading || settingsQuery.isLoading || relayGamesQuery.isLoading

    if (isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading franchise…</Text></View>
    }
    if (!franchise) {
        return <View style={styles.container}><Text style={styles.emptyText}>Franchise not found.</Text></View>
    }

    // Web wraps the timeline at 5-per-row (≤799px) / 4-per-row (≤479px); above that it's one
    // unwrapped row with entries squeezed to fit (flex: 1 1 0 each) — ported directly from
    // franchises.css's tiered @media rules rather than inventing new breakpoints.
    const perRow = breakpoint === 'mobilePortrait' ? 4 : breakpoint === 'mobileLandscapeTabletPortrait' ? 5 : timelineEntries.length || 1
    const pairWidthPct = 100 / perRow

    function onTitleChange(text: string) {
        setTitleDraft(text)
        if (renameTimer.current) clearTimeout(renameTimer.current)
        const v = text.trim()
        if (!v) return
        renameTimer.current = setTimeout(() => renameMutation.mutate(v), 600)
    }

    async function onRemoveEntry(appid: number, name: string) {
        const ok = await confirmDialog(`Remove "${name}"?`, 'Remove this game from the franchise.', 'Remove')
        if (!ok) return
        removeEntryMutation.mutate(appid)
    }

    async function onDeleteFranchise() {
        const ok = await confirmDialog(
            `Delete "${franchise?.name ?? ''}"?`,
            'This will permanently remove this franchise and all its entries.',
            'Delete',
        )
        if (!ok) return
        deleteMutation.mutate()
    }

    const renderEntry = ({ item, drag, isActive, getIndex }: DraggableListRenderItem<typeof timelineEntries[number]>) => {
        const owned = ownedMap.get(item.appid)
        const hrs = fmtHours(owned?.playtimeMinutes)
        const idx = getIndex() ?? 0
        return (
            // No game-card long-press menu on franchise entries: onLongPress is already claimed by
            // drag-to-reorder (entry ordering is this screen's core interaction). Adding the card
            // menu would clobber drag, so it's intentionally omitted on this drag-enabled list.
            <Pressable
                onLongPress={drag}
                style={StyleSheet.flatten([styles.entry, isActive && styles.entryActive])}
            >
                <Text style={styles.entryHandle}>⠿</Text>
                <Text style={styles.entryNum}>{idx + 1}</Text>
                {apiHost && (
                    <Image
                        source={{ uri: `${apiHost}/relay/images/steam/games/${item.appid}/header.jpg` }}
                        style={styles.entryThumb}
                        contentFit="cover"
                    />
                )}
                <View style={styles.entryInfo}>
                    <Link href={`/game/${item.appid}` as never} asChild>
                        <Pressable><Text style={styles.entryName} numberOfLines={1}>{item.name}</Text></Pressable>
                    </Link>
                    <View style={styles.entryMeta}>
                        {hrs && <Text style={styles.entryHours}>{hrs}</Text>}
                        {item.statusLabel && (
                            <Text style={[styles.statusBadge, { color: item.fill.color === 'transparent' ? colors.textMuted : item.fill.color }]}>
                                {item.statusLabel}
                            </Text>
                        )}
                    </View>
                </View>
                <Pressable onPress={() => onRemoveEntry(item.appid, item.name)} hitSlop={8}>
                    <Text style={styles.entryRemove}>×</Text>
                </Pressable>
            </Pressable>
        )
    }

    return (
        <ScrollView style={styles.container}>
            <View style={styles.hero}>
                {heroFrames.length > 0 && <HeroCrossfade frames={heroFrames} intervalMs={6000} fadeMs={1800} />}
                <View style={styles.heroScrim} />
                <View style={styles.heroContent}>
                    <Pressable onPress={() => router.push('/franchises' as never)}>
                        <Text style={styles.heroBack}>← Franchises</Text>
                    </Pressable>
                    <TextInput
                        style={styles.titleInput}
                        value={titleDraft ?? franchise.name}
                        onChangeText={onTitleChange}
                        maxLength={100}
                        placeholder="Franchise name"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                    />
                    <View style={styles.heroStats}>
                        <Text style={styles.heroStat}><Text style={styles.heroStatValue}>{stats.completed}</Text>/{stats.total} completed</Text>
                        {fmtHours(stats.totalMins) && <Text style={styles.heroStat}><Text style={styles.heroStatValue}>{fmtHours(stats.totalMins)}</Text> played</Text>}
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionLabel}>Progress</Text>
                {timelineEntries.length > 0 && (
                    <View style={styles.timeline}>
                        <View style={styles.tlPairs}>
                            {timelineEntries.map(e => (
                                <View key={e.appid} style={{ width: `${pairWidthPct}%`, padding: 1 }}>
                                    {/* Web wraps each timeline capsule in <a href="/game/{appid}">; tap navigates.
                                        Using router.push rather than <Link asChild> to avoid the Slot-clone sizing
                                        quirk documented for this app's build. Long-press opens the game-card menu
                                        (these capsules are not drag handles — reordering lives in the Entries list below). */}
                                    <Pressable
                                        onPress={() => router.push(`/game/${e.appid}` as never)}
                                        onLongPress={(ev) => openGameCardMenu(e.appid, flags[e.appid], { x: ev.nativeEvent.pageX, y: ev.nativeEvent.pageY })}
                                    >
                                        {apiHost && (
                                            <Image
                                                source={{ uri: `${apiHost}/relay/images/steam/games/${e.appid}/header.jpg` }}
                                                style={styles.tlImg}
                                                contentFit="cover"
                                            />
                                        )}
                                        <View style={styles.tlSeg}>
                                            <View style={[styles.tlFill, { width: `${e.fill.pct}%`, backgroundColor: e.fill.color }]} />
                                        </View>
                                    </Pressable>
                                </View>
                            ))}
                        </View>
                        <Text style={styles.tlFooter}>{timelinePct}% · {completedCount}/{entries.length} completed</Text>
                    </View>
                )}
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionLabel}>Add Game</Text>
                <View>
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search your library or wishlist…"
                        placeholderTextColor={colors.textMuted}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                    />
                    {searchFocused && searchResults.length > 0 && (
                        <View style={styles.searchResults}>
                            {searchResults.map(r => (
                                <Pressable
                                    key={r.appid}
                                    style={styles.searchItem}
                                    onPress={() => addEntryMutation.mutate({ appid: r.appid, name: r.name })}
                                >
                                    {apiHost && (
                                        <Image source={{ uri: `${apiHost}/relay/images/steam/games/${r.appid}/header.jpg` }} style={styles.searchItemImg} contentFit="cover" />
                                    )}
                                    <Text style={styles.searchItemName} numberOfLines={1}>{r.name}</Text>
                                    <Text style={styles.searchItemTag}>{r.tag}</Text>
                                </Pressable>
                            ))}
                        </View>
                    )}
                    {searchFocused && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                        <View style={styles.searchResults}>
                            <Text style={styles.searchNoResults}>No matching games found</Text>
                        </View>
                    )}
                </View>
            </View>

            <Text style={styles.sectionLabel}>Entries</Text>
            <DraggableList
                data={timelineEntries}
                keyExtractor={(e) => String(e.appid)}
                onReorder={(reordered) => reorderMutation.mutate(reordered.map(e => e.appid))}
                renderItem={renderEntry}
            />

            <View style={styles.deleteWrap}>
                <Pressable style={styles.deleteBtn} onPress={onDeleteFranchise}>
                    <Text style={styles.deleteBtnText}>Delete Franchise</Text>
                </Pressable>
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    hero: { minHeight: 220, backgroundColor: colors.bgRaised, overflow: 'hidden' },
    heroScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(13,11,9,0.35)' },
    heroContent: { minHeight: 220, justifyContent: 'flex-end', padding: spacing.md, gap: spacing.xs },
    heroBack: { fontSize: 11.5, color: 'rgba(237,233,223,0.6)', marginBottom: spacing.sm },
    titleInput: {
        fontFamily: fonts.title, fontSize: 22, fontWeight: '700', color: '#fff',
        borderBottomWidth: 2, borderBottomColor: 'transparent', paddingVertical: 2,
    },
    heroStats: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
    heroStat: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontFamily: fonts.ui },
    heroStatValue: { color: '#e8b870', fontFamily: fonts.uiBold },
    section: { padding: spacing.md },
    sectionLabel: {
        fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5,
        color: colors.textMuted, fontFamily: fonts.uiBold, marginBottom: spacing.sm, paddingHorizontal: spacing.md,
    },
    timeline: { gap: spacing.sm },
    tlPairs: { flexDirection: 'row', flexWrap: 'wrap' },
    tlImg: { width: '100%', aspectRatio: 460 / 215, borderRadius: 2, backgroundColor: colors.bgHover },
    tlSeg: { height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 1, marginTop: 2, overflow: 'hidden' },
    tlFill: { height: '100%' },
    tlFooter: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.ui, textAlign: 'right', opacity: 0.65 },
    searchInput: {
        backgroundColor: '#1b1916', borderWidth: 1, borderColor: colors.border, borderRadius: radius,
        color: colors.text, fontFamily: fonts.ui, fontSize: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        marginHorizontal: spacing.md,
    },
    searchResults: {
        backgroundColor: '#1e1c18', borderWidth: 1, borderColor: '#c9913d', borderRadius: radius,
        marginHorizontal: spacing.md, marginTop: spacing.xs, maxHeight: 280,
    },
    searchItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
    searchItemImg: { width: 32, height: 15, borderRadius: 2 },
    searchItemName: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 13 },
    searchItemTag: { fontSize: 10, fontFamily: fonts.uiBold, color: colors.textMuted, backgroundColor: colors.bgHover, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
    searchNoResults: { padding: spacing.md, fontSize: 13, color: colors.textMuted, fontFamily: fonts.ui, textAlign: 'center' },
    entry: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        marginHorizontal: spacing.md, marginBottom: spacing.xs, padding: spacing.sm,
        backgroundColor: '#1b1916', borderWidth: 1, borderColor: colors.border, borderRadius: radius,
    },
    entryActive: { borderColor: '#c9913d' },
    entryHandle: { color: colors.textMuted, fontSize: 16 },
    entryNum: { fontSize: 12, fontFamily: fonts.uiBold, color: colors.textMuted, minWidth: 20, textAlign: 'right' },
    entryThumb: { width: 46, height: 22, borderRadius: 3, backgroundColor: colors.bgHover },
    entryInfo: { flex: 1, gap: 2 },
    entryName: { fontSize: 13, fontFamily: fonts.uiBold, color: colors.text },
    entryMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    entryHours: { fontSize: 11, color: colors.textMuted, fontFamily: fonts.ui },
    statusBadge: { fontSize: 10, fontFamily: fonts.uiBold, textTransform: 'uppercase' },
    entryRemove: { fontSize: 18, color: colors.textMuted, paddingHorizontal: 4 },
    deleteWrap: { margin: spacing.md, marginTop: spacing.lg },
    deleteBtn: {
        alignSelf: 'flex-start', backgroundColor: 'rgba(201, 145, 61, 0.18)', borderWidth: 1,
        borderColor: '#c9913d', borderRadius: radius, paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    },
    deleteBtnText: { color: '#e8b870', fontFamily: fonts.ui, fontSize: 12 },
})
