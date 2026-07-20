import { Feather } from '@expo/vector-icons'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { fmtCount } from '@/utils/gameRender'
import type { CommunityReviews as CommunityReviewsData } from 'gaming-journal-contracts/communityReviews'

// Port of CommunityReviews.svelte + game.css (.rev-summary / .rev-ratio / .rev-list / .rev-card).
// The summary is a VERTICAL block (score row on top, full-width ratio bar below) — game.css's
// .rev-summary is `flex-direction: column`, not the side-by-side layout used previously. The
// individual-review list is a fixed-size horizontal grid (300px-wide × 240px-tall cards,
// grid-auto-flow: column, overflow-x: auto) with no responsive rules, so it maps directly onto a
// horizontal ScrollView with those exact card dimensions.
function ratioColor(pct: number) {
    return pct >= 80 ? '#4c9a4c' : pct >= 60 ? '#a07018' : '#963030'
}

export function CommunityReviews({ data }: { data: CommunityReviewsData | null | undefined }) {
    if (!data?.totalReviews) {
        return (
            <View style={styles.section}>
                <Text style={styles.title}>Community Reviews</Text>
                <Text style={styles.empty}>{data === null ? 'Loading community reviews…' : 'No community reviews on Steam yet.'}</Text>
            </View>
        )
    }

    const s = data.summary
    const pct = s?.ratio != null ? Math.round(s.ratio) : null
    const color = pct != null ? ratioColor(pct) : colors.textMuted

    return (
        <View style={styles.section}>
            <Text style={styles.title}>Community Reviews</Text>

            {s && data.totalReviews > 0 && (
                <View style={styles.summary}>
                    <View style={styles.summaryScore}>
                        <Text style={styles.summaryDesc}>{s.scoreDesc ?? ''}</Text>
                        <Text style={styles.summaryCounts}>
                            {fmtCount(s.totalPositive)} positive · {fmtCount(s.totalNegative)} negative · {fmtCount(data.totalReviews)} total
                        </Text>
                    </View>
                    {pct != null && (
                        <View style={styles.ratioWrap}>
                            <View style={styles.ratioBar}>
                                <View style={[styles.ratioFill, { width: `${pct}%`, backgroundColor: color }]} />
                            </View>
                            <Text style={[styles.ratioPct, { color }]}>{pct}%</Text>
                        </View>
                    )}
                </View>
            )}

            {data.reviews?.length ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.listContent}
                >
                    {data.reviews.map((r, i) => {
                        const date = new Date(r.postedAt ?? Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                        const helpful = (r.votesUp ?? 0) > 0 ? `${fmtCount(r.votesUp)} found helpful` : null
                        return (
                            <View key={r.id ?? i} style={styles.card}>
                                <View style={styles.cardHeader}>
                                    <Feather
                                        name={r.votedUp ? 'thumbs-up' : 'thumbs-down'}
                                        size={18}
                                        color={r.votedUp ? '#4c9a4c' : '#963030'}
                                    />
                                    <View style={styles.cardMeta}>
                                        {r.hoursAtReview != null && <Text style={styles.metaHours}>{Math.round(r.hoursAtReview).toLocaleString()}h at review</Text>}
                                        <Text style={styles.metaDate}>{date}</Text>
                                        {r.earlyAccess && <Text style={styles.badge}>Early Access</Text>}
                                    </View>
                                    {helpful && <Text style={styles.helpful}>{helpful}</Text>}
                                </View>
                                <Text style={styles.cardText} numberOfLines={8}>{r.text ?? ''}</Text>
                            </View>
                        )
                    })}
                </ScrollView>
            ) : (
                <Text style={styles.empty}>No English reviews cached yet.</Text>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, fontStyle: 'italic' },

    // .rev-summary — column stack, padded card
    summary: {
        gap: 10,
        marginBottom: spacing.xl,
        paddingVertical: 16,
        paddingHorizontal: 18,
        backgroundColor: colors.bgRaised,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius,
    },
    summaryScore: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
    summaryDesc: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
    summaryCounts: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    ratioWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    ratioBar: { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
    ratioFill: { height: '100%', borderRadius: 3 },
    ratioPct: { fontFamily: fonts.uiBold, fontSize: 13, minWidth: 38, textAlign: 'right' },

    // .rev-list — 300px-wide × 240px-tall cards, 12px gap; cards start at the section content edge
    // and scroll horizontally (matches game.css's overflow-x: auto grid).
    listContent: { gap: 12, paddingBottom: 8 },
    card: {
        width: 300,
        height: 240,
        backgroundColor: colors.bgRaised,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius,
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
    cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 },
    metaHours: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    metaDate: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    badge: {
        color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, textTransform: 'uppercase',
        letterSpacing: 0.4, backgroundColor: colors.border, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 1,
    },
    helpful: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11.5, marginLeft: 'auto' },
    cardText: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, lineHeight: 21, flex: 1 },
})
