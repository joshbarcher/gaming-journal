import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtCount } from '@/utils/gameRender'
import type { SteamUserReview } from 'gaming-journal-contracts/steamReview'

// Port of MyReview.svelte — the user's own Steam review, read-only (no editing; Steam reviews are
// managed on Steam itself).
export function MyReview({ review }: { review: SteamUserReview | null | undefined }) {
    const [expanded, setExpanded] = useState(false)
    if (!review) return null

    const date = review.timestamp_created
        ? new Date(review.timestamp_created * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : null
    const hours = review.author?.playtime_at_review != null ? Math.round(review.author.playtime_at_review / 60) : null
    const helpful = (review.votes_up ?? 0) > 0 ? `${fmtCount(review.votes_up)} found helpful` : null

    return (
        <View style={styles.section}>
            <Text style={styles.title}>Steam Review</Text>
            <View style={styles.card}>
                <View style={styles.header}>
                    <Text style={[styles.verdict, { color: review.voted_up ? '#4c9a4c' : '#963030' }]}>
                        {review.voted_up ? '👍 Recommended' : '👎 Not Recommended'}
                    </Text>
                    <View style={styles.meta}>
                        {hours != null && <Text style={styles.metaText}>{hours.toLocaleString()}h at review</Text>}
                        {date && <Text style={styles.metaText}>{date}</Text>}
                        {review.written_during_early_access && <Text style={styles.badge}>Early Access</Text>}
                    </View>
                    {helpful && <Text style={styles.helpful}>{helpful}</Text>}
                    {review.review && (
                        <Pressable onPress={() => setExpanded(v => !v)}>
                            <Text style={styles.showMore}>{expanded ? 'Hide review' : 'Show review'}</Text>
                        </Pressable>
                    )}
                </View>
                {review.review && expanded && <Text style={styles.body}>{review.review}</Text>}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 4, padding: spacing.sm, gap: spacing.xs },
    header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    verdict: { fontFamily: fonts.uiBold, fontSize: 13 },
    meta: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    metaText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    badge: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase' },
    helpful: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    showMore: { color: '#c8a84b', fontFamily: fonts.uiBold, fontSize: 12 },
    body: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20, marginTop: spacing.xs },
})
