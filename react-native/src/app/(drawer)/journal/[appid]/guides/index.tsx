import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getGameDetail } from '@/api/gamePage'
import { reparseGuide } from '@/api/guideJobs'
import { getDownloadedGuides } from '@/api/journal'
import { Lucide } from '@/components/shared/Lucide'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { DownloadedGuide } from 'gaming-journal-contracts/downloadedGuides'

// Port of GuidesList.svelte (journal/guide) — the downloaded-guides list reached on the web via the
// "Guides" breadcrumb. On native the entry point is the dashboard Guides card header (the "(N)"
// count is a link). Same data (getDownloadedGuides = GET /relay/api/guides/{appid}) and the same
// card fields (source icon+label, title, author, pages · size · added-date). Grid → single-column
// list on mobile.
const SOURCE_LABELS: Record<string, string> = {
    gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8',
    gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker', thegamer: 'TheGamer',
}

function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtBytes(n: number | null | undefined): string {
    if (!n) return ''
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function GuidesListScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const apiHost = useApiHost().data

    const guidesQuery = useQuery({ queryKey: ['downloadedGuides', appid], queryFn: () => getDownloadedGuides(appid) })
    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const guides = guidesQuery.data ?? []
    const gameName = gameQuery.data?.name ?? ''

    // guideId of the card whose reparse request is in flight — blocks a double-tap from
    // enqueueing twice while the POST is still on the wire. Mirrors GuidesList.svelte.
    const [reparsing, setReparsing] = useState<string | null>(null)
    const [reparseError, setReparseError] = useState<string | null>(null)

    async function reparse(g: DownloadedGuide) {
        if (reparsing) return
        setReparsing(g.guideId)
        setReparseError(null)
        try {
            await reparseGuide({ steamId: String(appid), source: g.source, guideId: g.guideId, gameName })
            // Land on Downloads so the job's progress is actually visible.
            router.push('/downloads' as never)
        } catch {
            setReparseError('Could not start the re-parse.')
        } finally {
            setReparsing(null)
        }
    }

    return (
        <View style={styles.container}>
            <View style={styles.nav}>
                <Pressable onPress={() => router.back()} hitSlop={8}>
                    <Text style={styles.backBtn}>‹ {gameName || 'Journal'}</Text>
                </Pressable>
                <Text style={styles.title}>Guides</Text>
            </View>

            {guidesQuery.isLoading ? (
                <Text style={styles.stateText}>Loading guides…</Text>
            ) : guidesQuery.isError ? (
                <Text style={styles.stateText}>Failed to load guides.</Text>
            ) : guides.length === 0 ? (
                <Text style={styles.stateText}>
                    No guides downloaded yet. Use the Guides card on the journal dashboard to find and download guides.
                </Text>
            ) : (
                <ScrollView contentContainerStyle={styles.list}>
                    {!!reparseError && <Text style={styles.errorText}>{reparseError}</Text>}
                    {guides.map((g: DownloadedGuide) => (
                        <Pressable
                            key={`${g.source}-${g.guideId}`}
                            style={styles.card}
                            onPress={() => router.push(`/journal/${appid}/guides/${g.source}/${g.guideId}` as never)}
                        >
                            <View style={styles.cardSource}>
                                {apiHost && (
                                    <Image source={{ uri: `${apiHost}/images/guides/${g.source}.webp` }} style={styles.sourceIcon} contentFit="contain" />
                                )}
                                <Text style={styles.sourceLabel}>{SOURCE_LABELS[g.source] ?? g.source}</Text>
                            </View>
                            {/* Top-right re-parse, matching the web card. Nested inside the card
                                Pressable, so it stops propagation to avoid also navigating. */}
                            <Pressable
                                style={styles.refreshBtn}
                                hitSlop={8}
                                disabled={reparsing !== null}
                                accessibilityLabel={`Re-parse ${g.title}`}
                                onPress={(e) => { e.stopPropagation(); reparse(g) }}
                            >
                                {reparsing === g.guideId
                                    ? <ActivityIndicator size="small" color={colors.accent} />
                                    : <Lucide name="refresh-cw" size={16} color={colors.textMuted} />}
                            </Pressable>
                            <Text style={styles.cardTitle} numberOfLines={2}>{g.title}</Text>
                            {!!g.author && <Text style={styles.cardAuthor}>by {g.author}</Text>}
                            <Text style={styles.cardMeta}>
                                {(g.pageCount ?? 0)} {g.pageCount === 1 ? 'page' : 'pages'}
                                {g.sizeBytes ? ` · ${fmtBytes(g.sizeBytes)}` : ''}
                                {` · Added ${fmtDate(g.parsedAt)}`}
                            </Text>
                        </Pressable>
                    ))}
                </ScrollView>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    nav: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
    backBtn: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    stateText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, padding: spacing.xl, textAlign: 'center', lineHeight: 19 },
    errorText: { color: colors.coral, fontFamily: fonts.ui, fontSize: 12, textAlign: 'center', paddingBottom: spacing.xs },
    list: { padding: spacing.md, gap: spacing.sm },
    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius,
        padding: spacing.md, gap: 4,
        position: 'relative',
    },
    // Always visible on native — there is no hover to reveal it on, unlike the web card.
    refreshBtn: {
        position: 'absolute', top: spacing.sm, right: spacing.sm,
        width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
    },
    // Leave room for refreshBtn so a long source label can't run under it
    cardSource: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingRight: 28 },
    sourceIcon: { width: 20, height: 20 },
    sourceLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
    cardTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14, lineHeight: 19 },
    cardAuthor: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    cardMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginTop: 2 },
})
