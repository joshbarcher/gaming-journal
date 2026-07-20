import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import {
    fmtCompact, fmtSize, getNexusData, nexusThumbFallback, nexusThumbUri, refreshNexusData,
    type NexusData, type NexusModFull,
} from '@/api/nexus'
import { getSettings } from '@/api/settings'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useGridColumns } from '@/hooks/useGridColumns'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// Web `.nxm-grid` (game-page section) = repeat(auto-fill, minmax(260px,1fr)), gap 16px — but it sits
// inside .game-body's nav-rail inset (padding: 44px 40px 0 68px = ~108px horizontal). That inset is
// why the web section fans to 3 columns at desktop width, where the un-inset mods LIST page shows 4.
// Feeding useGridColumns the same effective inset reproduces the web section's column COUNT; the
// cards are then laid across native's real section width (padding spacing.md) so they fill it.
const WEB_SECTION_INSET = 108
const GRID_GAP = spacing.lg // web .nxm-grid gap: 16px

// Port of NexusMods.svelte (the game-page "Mods" SECTION). Fetches its own data (unlike ProtonDB/
// PCGW which receive it as a prop) so the game-page integrator only needs `<NexusMods appid name/>`.
// Renders nothing unless the game is on Nexus and has mods — matching the web's
// `{#if nexusData?.domainName && mods.length}`.
export function NexusMods({ appid, name }: { appid: number; name?: string }) {
    const apiHost = useApiHost().data
    const queryClient = useQueryClient()

    const nexusQuery = useQuery({
        queryKey: ['nexus', appid],
        queryFn: () => getNexusData(appid, name),
    })
    // The mods' 3-state filter is its own control on the list page; the section just blurs adult
    // thumbnails when the shared "Hide Adult-Only Content" setting is on (web's adultContent.hide).
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const hideAdult = settingsQuery.data?.hideAdultContent ?? true

    const refresh = useMutation({
        mutationFn: () => refreshNexusData(appid, name),
        onSuccess: (data) => queryClient.setQueryData(['nexus', appid], data),
    })

    // Fluid column count mirroring the web's minmax(260px) auto-fill within .game-body's inset
    // (see WEB_SECTION_INSET) — replaces the old hardcoded 2-up. Cards fill native's real width.
    const numColumns = useGridColumns(260, { gap: GRID_GAP, horizontalPadding: WEB_SECTION_INSET, min: 2 })
    const { width } = useWindowDimensions()
    const breakpoint = useBreakpoint()
    const collapsed = useSidebarStore(s => s.collapsed)
    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const rail = isPermanentRail ? (collapsed ? 68 : 280) : 0
    const contentWidth = Math.max(1, width - rail - spacing.md * 2)
    const cardW = numColumns > 1
        ? Math.floor((contentWidth - GRID_GAP * (numColumns - 1)) / numColumns)
        : contentWidth

    const data: NexusData | null | undefined = nexusQuery.data
    const mods = data?.mods ?? []
    if (!data?.domainName || mods.length === 0) return null

    const totalStr = (data.totalMods ?? 0).toLocaleString()
    const goList = () => router.push(`/game/${appid}/mods` as never)

    return (
        <View style={styles.section}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>Mods</Text>
                <Pressable onPress={goList} hitSlop={6}>
                    <Text style={styles.allLink}>All {totalStr} ›</Text>
                </Pressable>
                <Pressable onPress={() => refresh.mutate()} disabled={refresh.isPending} hitSlop={8}>
                    <Text style={styles.refreshBtn}>{refresh.isPending ? '⟳' : '↻'}</Text>
                </Pressable>
            </View>

            <View style={styles.grid}>
                {mods.map(mod => (
                    <ModCard
                        key={mod.modId}
                        mod={mod}
                        apiHost={apiHost}
                        hideAdult={hideAdult}
                        width={cardW}
                        onPress={() => router.push(`/game/${appid}/mods/${mod.modId}` as never)}
                    />
                ))}
            </View>

            <Pressable style={styles.moreBtn} onPress={goList}>
                <Text style={styles.moreText}>Browse all {totalStr} mods →</Text>
            </Pressable>
        </View>
    )
}

// ── Shared mod card (reused by the full mods list page) ─────────────────────────────────────────
export function ModCard({ mod, apiHost, hideAdult, onPress, showSize, onExternal, width }: {
    mod: NexusModFull
    apiHost: string | undefined
    hideAdult: boolean
    onPress: () => void
    showSize?: boolean
    onExternal?: () => void
    // Explicit pixel width from the game-page section's fluid column math; the list page (FlatList
    // numColumns=2) omits it and falls back to the 48% two-up default in styles.cardWrap.
    width?: number
}) {
    const primary = nexusThumbUri(mod, apiHost)
    const fallback = nexusThumbFallback(mod)
    const blur = mod.adult && hideAdult

    return (
        <View style={[styles.cardWrap, width != null && { width }]}>
            <Pressable style={styles.card} onPress={onPress}>
                <View style={styles.thumb}>
                    <ModThumb primary={primary} fallback={fallback} blur={blur} />
                    {mod.adult && <Text style={styles.adultBadge}>18+</Text>}
                    {!!mod.category && <Text style={styles.catBadge} numberOfLines={1}>{mod.category}</Text>}
                </View>
                <View style={styles.body}>
                    <Text style={styles.name} numberOfLines={2}>{mod.name}</Text>
                    {!!mod.summary && <Text style={styles.summary} numberOfLines={2}>{mod.summary}</Text>}
                    <View style={styles.stats}>
                        <Text style={styles.statEndorse}>▲ {fmtCompact(mod.endorsements)}</Text>
                        <Text style={styles.stat}>⭳ {fmtCompact(mod.downloads)}</Text>
                        {showSize && !!mod.fileSize && <Text style={styles.statSize}>{fmtSize(mod.fileSize)}</Text>}
                    </View>
                </View>
            </Pressable>
            {onExternal && (
                <Pressable style={styles.extCorner} onPress={onExternal} hitSlop={6}>
                    <Text style={styles.extCornerText}>↗</Text>
                </Pressable>
            )}
        </View>
    )
}

// Thumbnail with the web's one-shot CDN fallback (nexusImgError): try the relay-mirrored copy, fall
// back to the Nexus CDN once, then hide. Adult thumbs are blurred, not removed, when hideAdult is on.
function ModThumb({ primary, fallback, blur }: { primary: string | null; fallback: string | null; blur: boolean }) {
    const [uri, setUri] = useState<string | null>(primary)
    const triedRef = useRef(false)
    useEffect(() => { setUri(primary); triedRef.current = false }, [primary])

    if (!uri) return <View style={styles.thumbEmpty} />
    return (
        <Image
            source={{ uri }}
            style={styles.thumbImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            blurRadius={blur ? 28 : 0}
            onError={() => {
                if (fallback && !triedRef.current && fallback !== uri) { triedRef.current = true; setUri(fallback) }
                else setUri(null)
            }}
        />
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, flex: 1 },
    allLink: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    refreshBtn: { color: colors.textMuted, fontSize: 16 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
    moreBtn: {
        marginTop: spacing.md, paddingVertical: spacing.sm, borderRadius: radius,
        borderWidth: 1, borderColor: colors.border, alignItems: 'center',
    },
    moreText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },

    // Card — shared with the list page. Two-up on a phone.
    cardWrap: { width: '48%', position: 'relative' },
    card: {
        flex: 1, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden',
    },
    thumb: { aspectRatio: 16 / 9, backgroundColor: colors.bgHover, position: 'relative' },
    thumbImg: { width: '100%', height: '100%' },
    thumbEmpty: { width: '100%', height: '100%', backgroundColor: colors.bgHover },
    adultBadge: {
        position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(224,80,80,0.9)', color: '#fff',
        fontFamily: fonts.uiBold, fontSize: 9, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3, overflow: 'hidden',
    },
    catBadge: {
        position: 'absolute', bottom: 4, left: 4, maxWidth: '80%', backgroundColor: 'rgba(0,0,0,0.65)', color: colors.text,
        fontFamily: fonts.ui, fontSize: 9, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3, overflow: 'hidden',
    },
    body: { padding: spacing.sm, gap: 3 },
    name: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    summary: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, lineHeight: 15 },
    stats: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
    statEndorse: { color: colors.accent2, fontFamily: fonts.uiBold, fontSize: 11 },
    stat: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    statSize: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginLeft: 'auto' },
    extCorner: {
        position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
        backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
    },
    extCornerText: { color: colors.text, fontSize: 12 },
})
