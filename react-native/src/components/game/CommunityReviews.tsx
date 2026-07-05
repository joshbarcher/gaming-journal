import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { fmtCount } from '@/utils/gameRender'
import type { CommunityReviews as CommunityReviewsData } from 'gaming-journal-contracts/communityReviews'

// Port of CommunityReviews.svelte. The web's individual-review list is a fixed-size horizontal
// grid (300px cards, 240px tall, grid-auto-flow: column, overflow-x: auto) — this is already the
// same shape at every breakpoint on web (no responsive rules for `.rev-list` found in game.css),
// so it maps directly onto a horizontal ScrollView here with no per-tier adaptation needed.
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
                    <View>
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.list}>
                    {data.reviews.map((r, i) => {
                        const date = new Date(r.postedAt ?? Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                        const helpful = (r.votesUp ?? 0) > 0 ? `${fmtCount(r.votesUp)} found helpful` : null
                        return (
                            <View key={r.id ?? i} style={styles.card}>
                                <View style={styles.cardHeader}>
                                    <Text style={{ color: r.votedUp ? '#4c9a4c' : '#963030', fontSize: 16 }}>{r.votedUp ? '👍' : '👎'}</Text>
                                    <View style={styles.cardMeta}>
                                        {r.hoursAtReview != null && <Text style={styles.metaText}>{Math.round(r.hoursAtReview).toLocaleString()}h at review</Text>}
                                        <Text style={styles.metaText}>{date}</Text>
                                        {r.earlyAccess && <Text style={styles.badgeText}>Early Access</Text>}
                                    </View>
                                </View>
                                {helpful && <Text style={styles.helpfulText}>{helpful}</Text>}
                                <Text style={styles.cardText} numberOfLines={7}>{r.text ?? ''}</Text>
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
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    summaryDesc: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
    summaryCounts: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginTop: 2 },
    ratioWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, width: 140 },
    ratioBar: { flex: 1, height: 6, backgroundColor: colors.bgHover, borderRadius: 3, overflow: 'hidden' },
    ratioFill: { height: '100%' },
    ratioPct: { fontFamily: fonts.uiBold, fontSize: 12, width: 36, textAlign: 'right' },
    list: { marginTop: spacing.xs },
    card: {
        width: 260, height: 200, marginRight: spacing.sm, backgroundColor: colors.bgRaised,
        borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, gap: 6,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
    cardMeta: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', flex: 1 },
    metaText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    badgeText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 9, textTransform: 'uppercase' },
    helpfulText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    cardText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
})
