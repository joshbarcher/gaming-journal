import { Feather } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { fmtCount } from '@/utils/gameRender'
import type { SteamUserReview } from 'gaming-journal-contracts/steamReview'

// Port of MyReview.svelte + game.css (.rev-mine). The user's own Steam review, read-only (no
// editing; Steam reviews are managed on Steam itself). Card is accent-tinted with a gold border;
// the thumb is a colored Feather icon (the web SVG paths ARE Feather's thumbs-up/down) sitting
// beside a plain-text verdict (the verdict text itself is NOT colored on web — only the thumb is).
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
                    <Feather
                        name={review.voted_up ? 'thumbs-up' : 'thumbs-down'}
                        size={18}
                        color={review.voted_up ? '#4c9a4c' : '#963030'}
                    />
                    <Text style={styles.verdict}>{review.voted_up ? 'Recommended' : 'Not Recommended'}</Text>
                    <View style={styles.meta}>
                        {hours != null && <Text style={styles.metaHours}>{hours.toLocaleString()}h at review</Text>}
                        {date && <Text style={styles.metaDate}>{date}</Text>}
                        {review.written_during_early_access && <Text style={styles.badge}>Early Access</Text>}
                    </View>
                    {helpful && <Text style={styles.helpful}>{helpful}</Text>}
                    {review.review && (
                        <Pressable onPress={() => setExpanded(v => !v)}>
                            <Text style={styles.showMore}>{expanded ? 'Hide review' : 'Show review'}</Text>
                        </Pressable>
                    )}
                </View>
                {review.review && expanded && (
                    <View style={styles.body}>
                        <Text style={styles.bodyText}>{review.review}</Text>
                    </View>
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    // .rev-mine — accent 5% over bg-raised (approximated as a solid tint), gold-tinted border
    card: {
        backgroundColor: '#242019',
        borderWidth: 1,
        borderColor: 'rgba(201, 168, 76, 0.3)',
        borderRadius: radius,
        paddingVertical: 18,
        paddingHorizontal: 20,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    verdict: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 15, flex: 1 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    metaHours: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    metaDate: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    badge: {
        color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, textTransform: 'uppercase',
        letterSpacing: 0.4, backgroundColor: colors.border, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 1,
    },
    helpful: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    showMore: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12.5, textDecorationLine: 'underline', marginLeft: 'auto' },
    body: { marginTop: 12 },
    bodyText: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, lineHeight: 22 },
})
