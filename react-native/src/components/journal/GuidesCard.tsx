import { Image } from 'expo-image'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useGuidesModalStore } from '@/store/guidesModalStore'
import { colors, fonts, spacing } from '@/theme/tokens'
import type { GuideSearchData } from 'gaming-journal-contracts/guideSearch'
import type { DownloadedGuide } from 'gaming-journal-contracts/downloadedGuides'

const SOURCE_LABELS: Record<string, string> = {
    gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8',
    gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker', thegamer: 'TheGamer',
}

// Port of JournalDashboard.svelte's Guides card. Downloaded tiles now navigate to the real guide
// landing screen (Phase 3's earlier items) and "Find" opens the real GuidesModalHost (this item) —
// both were inert placeholders until now, since neither destination existed yet.
export function GuidesCard({
    appid, gameName, guides, searchData, apiHost,
}: {
    appid: number
    gameName: string
    guides: DownloadedGuide[]
    searchData: GuideSearchData | null
    apiHost: string | undefined
}) {
    const openGuidesModal = useGuidesModalStore(s => s.open)

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                {/* The count is a link to the full downloaded-guides list (the web reaches it via the
                    "Guides" breadcrumb); "Find" still opens the search modal. */}
                <Pressable onPress={() => guides.length > 0 && router.push(`/journal/${appid}/guides` as never)} hitSlop={6}>
                    <Text style={styles.title}>
                        Guides{guides.length > 0 ? <Text style={styles.titleCount}> ({guides.length}) ›</Text> : ''}
                    </Text>
                </Pressable>
                <Pressable style={styles.findBtn} onPress={() => openGuidesModal(appid, gameName, guides, searchData)}>
                    <Text style={styles.findBtnText}>Find</Text>
                </Pressable>
            </View>
            {guides.length > 0 ? (
                <View style={styles.list}>
                    {guides.map(g => (
                        <Pressable
                            key={`${g.source}-${g.guideId}`}
                            style={styles.tile}
                            onPress={() => router.push(`/journal/${appid}/guides/${g.source}/${g.guideId}` as never)}
                        >
                            {apiHost && (
                                <Image source={{ uri: `${apiHost}/images/guides/${g.source}.webp` }} style={styles.tileIcon} contentFit="contain" />
                            )}
                            <View style={styles.tileBody}>
                                <Text style={styles.tileTitle} numberOfLines={1}>{g.title}</Text>
                                <Text style={styles.tileMeta}>{SOURCE_LABELS[g.source] ?? g.source} · {g.pageCount ?? 0} pages</Text>
                            </View>
                        </Pressable>
                    ))}
                </View>
            ) : (
                <Text style={styles.noData}>No guides downloaded yet</Text>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, gap: spacing.sm },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    titleCount: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    findBtn: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct, borderRadius: 4, paddingHorizontal: spacing.sm, paddingVertical: 3 },
    findBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    list: { gap: spacing.xs },
    tile: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.xs, backgroundColor: colors.bgHover, borderRadius: 4 },
    tileIcon: { width: 28, height: 28 },
    tileBody: { flex: 1, gap: 2 },
    tileTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    tileMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
})
