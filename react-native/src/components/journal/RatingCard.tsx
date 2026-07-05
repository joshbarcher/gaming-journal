import { Pressable, StyleSheet, Text, View } from 'react-native'

import { LegendaryStars } from '@/components/shared/LegendaryStars'
import { openReviewEditor } from '@/store/reviewEditorStore'
import { colors, fonts, spacing } from '@/theme/tokens'
import { RATING_KEYS, RATING_LBLS } from '@/utils/journalRender'
import type { LocalReview } from 'gaming-journal-contracts/localReview'

// Port of JournalDashboard.svelte's Rating card. Reuses the same ReviewEditor overlay the Game
// detail screen's Reviews section opens — same review, same editor, two entry points.
export function RatingCard({ appid, review }: { appid: number; review: LocalReview | null | undefined }) {
    const ratedKeys = RATING_KEYS.filter(k => review?.ratings?.[k] != null)

    return (
        <Pressable style={styles.card} onPress={() => openReviewEditor(appid, review ?? null)}>
            <View style={styles.header}>
                <Text style={styles.title}>My Rating</Text>
                {!review || !review.stars ? <Text style={styles.noData}>No rating</Text> : null}
            </View>
            {review && review.stars > 0 ? (
                <LegendaryStars stars={review.stars} variant="badge" size={16} />
            ) : (
                <Text style={styles.noData}>Click to add a review</Text>
            )}
            {review && ratedKeys.length > 0 && (
                <View style={styles.bars}>
                    {ratedKeys.map(k => (
                        <View key={k} style={styles.barLabeled}>
                            <View style={[styles.barFill, { width: `${(review.ratings![k] as number) * 10}%` }]} />
                            <Text style={styles.barLbl}>{RATING_LBLS[k]}</Text>
                            <Text style={styles.barVal}>{review.ratings![k]}</Text>
                        </View>
                    ))}
                </View>
            )}
            {review?.review && <Text style={styles.reviewPreview} numberOfLines={3}>{review.review}</Text>}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, gap: spacing.sm },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    bars: { gap: 4 },
    barLabeled: { height: 20, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden', justifyContent: 'center' },
    barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#c8a84b', borderRadius: 3 },
    barLbl: { position: 'absolute', left: 8, color: '#fff', fontSize: 9, fontFamily: fonts.uiBold, textTransform: 'uppercase' },
    barVal: { position: 'absolute', right: 8, color: '#fff', fontSize: 9, fontFamily: fonts.uiBold },
    reviewPreview: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
})
