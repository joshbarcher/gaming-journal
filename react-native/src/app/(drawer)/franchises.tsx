import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { createFranchise, getFranchises } from '@/api/franchises'
import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { mosaicSlots } from '@/utils/spreadIndices'
import type { Franchise } from 'gaming-journal-contracts/franchises'
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'

// Port of collections/franchises.md — franchise list. Read Franchises.svelte directly rather than
// relying on the doc summary alone, for franchiseStats()'s exact math and mosaicSlots()'s fallback
// chaining.
function fmtHours(mins: number): string | null {
    if (!mins) return null
    const h = mins / 60
    if (h < 1) return `${Math.round(mins)}m`
    if (h < 10) return `${h.toFixed(1)}h`
    return `${Math.round(h)}h`
}

export default function FranchisesScreen() {
    const franchisesQuery = useQuery({ queryKey: ['franchises'], queryFn: getFranchises })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const queryClient = useQueryClient()
    const [showCreate, setShowCreate] = useState(false)
    const [createName, setCreateName] = useState('')

    const createMutation = useMutation({
        mutationFn: (name: string) => createFranchise(name),
        onSuccess: (created) => {
            queryClient.setQueryData<Franchise[]>(['franchises'], (old) => [...(old ?? []), created])
            setShowCreate(false)
            setCreateName('')
            router.push(`/franchise/${created.id}` as never)
        },
    })

    const gameMap = useMemo(() => {
        const map = new Map<number, SteamGameRaw>()
        for (const g of gamesQuery.data ?? []) map.set(g.appid, g)
        return map
    }, [gamesQuery.data])

    const franchises = franchisesQuery.data ?? []
    const flags = flagsQuery.data ?? {}
    const apiHost = apiHostQuery.data
    const isLoading = franchisesQuery.isLoading || flagsQuery.isLoading || gamesQuery.isLoading

    // Auto-fill minmax(240px,1fr) on web has no fixed column count — approximated the same way
    // Library/Hall of Fame did (2/3/3), since a franchise card is roughly the same width class.
    const numColumns = breakpoint === 'mobilePortrait' ? 1 : breakpoint === 'mobileLandscapeTabletPortrait' ? 2 : 3

    if (isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading franchises…</Text></View>
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, breakpoint === 'mobilePortrait' && styles.headerStacked]}>
                <View>
                    <Text style={styles.eyebrow}>Collection</Text>
                    <Text style={styles.title}>Franchises</Text>
                    <Text style={styles.subtitle}>{franchises.length} franchise{franchises.length !== 1 ? 's' : ''}</Text>
                </View>
                <Pressable style={styles.newBtn} onPress={() => { setShowCreate(true); setCreateName('') }}>
                    <Text style={styles.newBtnText}>+ New Franchise</Text>
                </Pressable>
            </View>

            {franchises.length === 0 ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyIcon}>🎮</Text>
                    <Text style={styles.emptyText}>No franchises yet</Text>
                    <Text style={styles.emptySub}>Create your first franchise to start tracking a game series.</Text>
                </View>
            ) : (
                <FlatList
                    key={numColumns}
                    data={franchises}
                    numColumns={numColumns}
                    keyExtractor={(f) => f.id}
                    contentContainerStyle={styles.grid}
                    columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
                    renderItem={({ item: franchise }) => {
                        let completed = 0
                        let totalMins = 0
                        for (const e of franchise.entries) {
                            if (flags[e.appid]?.completed) completed++
                            totalMins += gameMap.get(e.appid)?.playtime_forever ?? 0
                        }
                        const pct = franchise.entries.length ? Math.round((completed / franchise.entries.length) * 100) : 0
                        const hrs = fmtHours(totalMins)
                        const slots = mosaicSlots(franchise.entries, 4)

                        return (
                            <Pressable
                                style={StyleSheet.flatten([styles.card, { flex: 1 / numColumns }])}
                                onPress={() => router.push(`/franchise/${franchise.id}` as never)}
                            >
                                <View style={styles.mosaic}>
                                    {franchise.entries.length > 0 && (
                                        <Text style={styles.mosaicCount}>
                                            {franchise.entries.length} game{franchise.entries.length !== 1 ? 's' : ''}
                                        </Text>
                                    )}
                                    {slots.map((candidates, i) => (
                                        <MosaicCell key={i} candidates={candidates} apiHost={apiHost} />
                                    ))}
                                </View>
                                <View style={styles.cardBody}>
                                    <Text style={styles.cardName} numberOfLines={1}>{franchise.name}</Text>
                                    <View style={styles.cardStats}>
                                        <Text style={styles.cardStat}>
                                            <Text style={styles.cardStatValue}>{completed}</Text>/{franchise.entries.length} completed
                                        </Text>
                                        {hrs && <Text style={styles.cardStat}><Text style={styles.cardStatValue}>{hrs}</Text> played</Text>}
                                    </View>
                                    <View style={styles.barTrack}>
                                        <View style={[styles.barFill, { width: `${pct}%` }]} />
                                    </View>
                                </View>
                            </Pressable>
                        )
                    }}
                />
            )}

            <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
                <Pressable style={styles.overlay} onPress={() => setShowCreate(false)}>
                    <Pressable style={styles.dialogBox} onPress={() => {}}>
                        <Text style={styles.dialogTitle}>New Franchise</Text>
                        <Text style={styles.dialogBody}>Enter a name for your new franchise series:</Text>
                        <TextInput
                            style={styles.dialogInput}
                            placeholder="e.g. Monster Hunter"
                            placeholderTextColor={colors.textMuted}
                            value={createName}
                            onChangeText={setCreateName}
                            maxLength={100}
                            autoFocus
                            onSubmitEditing={() => createName.trim() && createMutation.mutate(createName.trim())}
                        />
                        <View style={styles.dialogActions}>
                            <Pressable style={styles.dialogCancelBtn} onPress={() => setShowCreate(false)}>
                                <Text style={styles.dialogCancelText}>Cancel</Text>
                            </Pressable>
                            <Pressable
                                style={styles.dialogConfirmBtn}
                                onPress={() => createName.trim() && createMutation.mutate(createName.trim())}
                            >
                                <Text style={styles.dialogConfirmText}>Create</Text>
                            </Pressable>
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>
        </View>
    )
}

// Progressive fallback through candidate appids' header images — port of mosaicCell's Svelte
// action (tries each candidate in order via onerror) using expo-image's onError instead.
function MosaicCell({ candidates, apiHost }: { candidates: number[]; apiHost: string | undefined }) {
    const [idx, setIdx] = useState(0)
    if (!apiHost || idx >= candidates.length) return <View style={styles.mosaicPlaceholder} />
    return (
        <Image
            source={{ uri: `${apiHost}/relay/images/steam/games/${candidates[idx]}/header.jpg` }}
            style={styles.mosaicCellImg}
            contentFit="cover"
            onError={() => setIdx(i => i + 1)}
        />
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
        padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md,
    },
    headerStacked: { flexDirection: 'column', alignItems: 'flex-start' },
    eyebrow: { color: '#c9913d', fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
    newBtn: {
        backgroundColor: 'rgba(201, 145, 61, 0.18)', borderWidth: 1, borderColor: '#c9913d',
        borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    },
    newBtnText: { color: '#e8b870', fontFamily: fonts.uiBold, fontSize: 13 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.xxl },
    emptyIcon: { fontSize: 40, opacity: 0.4 },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 16 },
    emptySub: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, opacity: 0.7, textAlign: 'center' },
    grid: { padding: spacing.md },
    gridRow: { gap: spacing.sm },
    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius + 2, overflow: 'hidden', marginBottom: spacing.sm,
    },
    mosaic: {
        flexDirection: 'row', flexWrap: 'wrap', height: 120, backgroundColor: colors.bgHover,
    },
    mosaicCellImg: { width: '50%', height: '50%' },
    mosaicPlaceholder: { width: '50%', height: '50%', backgroundColor: colors.bgHover },
    mosaicCount: {
        position: 'absolute', bottom: 6, right: 8, zIndex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)', color: '#e8b870', fontFamily: fonts.uiBold, fontSize: 11,
        paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20,
    },
    cardBody: { padding: spacing.sm, gap: spacing.xs },
    cardName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
    cardStats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    cardStat: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    cardStatValue: { color: '#e8b870', fontFamily: fonts.uiBold },
    barTrack: { height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' },
    barFill: { height: '100%', backgroundColor: '#c9913d', borderRadius: 2 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    dialogBox: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius,
        padding: spacing.lg, width: '100%', maxWidth: 380, gap: spacing.sm,
    },
    dialogTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    dialogBody: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, marginBottom: spacing.xs },
    dialogInput: {
        backgroundColor: '#1b1916', borderWidth: 1, borderColor: colors.border, borderRadius: radius,
        color: colors.text, fontFamily: fonts.ui, fontSize: 14, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    },
    dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
    dialogCancelBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius, backgroundColor: colors.bgHover },
    dialogCancelText: { color: colors.text, fontFamily: fonts.ui },
    dialogConfirmBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius, backgroundColor: '#c9913d' },
    dialogConfirmText: { color: colors.bg, fontFamily: fonts.uiBold },
})
