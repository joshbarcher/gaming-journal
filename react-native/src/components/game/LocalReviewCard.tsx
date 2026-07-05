import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useState } from 'react'

import { LegendaryStars } from '@/components/shared/LegendaryStars'
import { openReviewEditor } from '@/store/reviewEditorStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { SLIDER_KEYS, BADGES } from '@/utils/reviewConstants'
import type { LocalReview } from 'gaming-journal-contracts/localReview'

// Port of LocalReviewCard.svelte. Two-column body (bars left, tags+badges right) collapses to
// one column at ≤479px — the ONLY breakpoint local-review.css defines for this layout (confirmed
// via grep; matches the same "single breakpoint" pattern already seen in game.css's HLTB section).
// Review text truncates to 3 lines with a "Read review ↓" toggle ONLY at ≤479px; wider tiers
// always show the full text — ported via useBreakpoint rather than guessed.
import { useBreakpoint } from '@/hooks/useBreakpoint'

export function LocalReviewCard({ appid, review }: { appid: number; review: LocalReview | null | undefined }) {
    const breakpoint = useBreakpoint()
    const [expanded, setExpanded] = useState(false)
    const isMobilePortrait = breakpoint === 'mobilePortrait'

    const ratings = review?.ratings ?? {}
    const activeBars = SLIDER_KEYS.filter(({ key }) => (ratings[key] ?? 0) > 0)
    const activeBadges = BADGES.filter(b => review?.badges?.[b.id])
    const hasColumns = activeBars.length > 0 || (review?.tags?.length ?? 0) > 0 || activeBadges.length > 0
    const twoColumn = !isMobilePortrait

    return (
        <View style={styles.section}>
            <View style={styles.header}>
                <Text style={styles.title}>Local Review</Text>
                <Pressable onPress={() => openReviewEditor(appid, review ?? null)}>
                    <Text style={styles.editBtn}>{review ? 'Edit Review' : '✦ Write a Review'}</Text>
                </Pressable>
            </View>

            {review ? (
                <View style={styles.card}>
                    <LegendaryStars stars={review.stars} variant="badge" size={18} />

                    {hasColumns && (
                        <View style={[styles.body, twoColumn && styles.bodyTwoCol]}>
                            <View style={twoColumn ? styles.colLeft : undefined}>
                                <View style={styles.bars}>
                                    {activeBars.map(({ key, label }) => {
                                        const val = ratings[key] as number
                                        return (
                                            <View key={key} style={styles.barLabeled}>
                                                <View style={[styles.barFill, { width: `${(val / 10) * 100}%` }]} />
                                                <Text style={styles.barLbl}>{label}</Text>
                                                <Text style={styles.barVal}>{val}</Text>
                                            </View>
                                        )
                                    })}
                                </View>
                            </View>
                            <View style={twoColumn ? styles.colRight : styles.colRightStacked}>
                                {(review.tags?.length ?? 0) > 0 && (
                                    <View style={styles.tagsRow}>
                                        {review.tags!.map(t => <Text key={t} style={styles.tagPill}>{t}</Text>)}
                                    </View>
                                )}
                                {activeBadges.length > 0 && (
                                    <View style={styles.badgesRow}>
                                        {activeBadges.map(b => {
                                            const val = review.badges![b.id]
                                            return (
                                                <View key={b.id} style={styles.badge}>
                                                    <View style={[styles.badgeCircle, { borderColor: b.color }]}>
                                                        <Text style={{ color: b.color, fontSize: 10, fontFamily: fonts.uiBold }}>
                                                            {b.hasCount && typeof val === 'number' && val > 1 ? `×${val}` : '●'}
                                                        </Text>
                                                    </View>
                                                    <Text style={styles.badgeLabel}>{b.label}</Text>
                                                </View>
                                            )
                                        })}
                                    </View>
                                )}
                            </View>
                        </View>
                    )}

                    {review.review && (
                        <View>
                            <Text style={styles.reviewText} numberOfLines={isMobilePortrait && !expanded ? 3 : undefined}>
                                {review.review}
                            </Text>
                            {isMobilePortrait && (
                                <Pressable onPress={() => setExpanded(v => !v)}>
                                    <Text style={styles.reviewToggle}>{expanded ? 'Show less ↑' : 'Read review ↓'}</Text>
                                </Pressable>
                            )}
                        </View>
                    )}
                </View>
            ) : (
                <Text style={styles.empty}>No local review yet.</Text>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    editBtn: { color: '#c8a84b', fontFamily: fonts.uiBold, fontSize: 12 },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.md, gap: spacing.sm },
    body: { gap: spacing.md },
    bodyTwoCol: { flexDirection: 'row' },
    colLeft: { flex: 1 },
    colRight: { flex: 1, gap: spacing.sm },
    colRightStacked: { gap: spacing.sm },
    bars: { gap: 4 },
    barLabeled: { height: 22, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden', justifyContent: 'center' },
    barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#c8a84b', borderRadius: 3 },
    barLbl: { position: 'absolute', left: 8, color: '#fff', fontSize: 9, fontFamily: fonts.uiBold, textTransform: 'uppercase' },
    barVal: { position: 'absolute', right: 8, color: '#fff', fontSize: 9, fontFamily: fonts.uiBold },
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tagPill: {
        color: '#c8a84b', fontFamily: fonts.ui, fontSize: 11, borderWidth: 1, borderColor: 'rgba(200,168,75,0.4)',
        backgroundColor: 'rgba(200,168,75,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
    },
    badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    badge: { alignItems: 'center', gap: 4, width: 60 },
    badgeCircle: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
    badgeLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 9, textAlign: 'center' },
    reviewText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20 },
    reviewToggle: { color: '#c8a84b', fontFamily: fonts.uiBold, fontSize: 12, marginTop: 4 },
})
