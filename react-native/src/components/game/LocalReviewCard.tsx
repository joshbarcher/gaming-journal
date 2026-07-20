import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useState } from 'react'

import { LegendaryStars } from '@/components/shared/LegendaryStars'
import { Lucide } from '@/components/shared/Lucide'
import { openReviewEditor } from '@/store/reviewEditorStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { SLIDER_KEYS, BADGES } from '@/utils/reviewConstants'
import type { LocalReview } from 'gaming-journal-contracts/localReview'

// Port of LocalReviewCard.svelte + local-review.css.
//
// WITH a review: a gold left-border card — stars (+ legendary badge), a two-column body (a 2-col
// GRID of characteristic bars on the left, tags + badges on the right), then the review text — with
// a bordered "Edit Review" pill BELOW the card (web renders the edit button after the card, not in
// the title row). WITHOUT a review: the web renders BOTH a full-width dashed "write a review" CTA
// card AND a smaller pill below it — both ported here verbatim.
//
// The two-column body collapses to one column at ≤479px — the ONLY breakpoint local-review.css
// defines for this layout. Review text truncates to 3 lines with a "Read review ↓" toggle ONLY at
// ≤479px; wider tiers always show the full text.
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

    const openEditor = () => openReviewEditor(appid, review ?? null)

    return (
        <View style={styles.section}>
            <Text style={styles.title}>Local Review</Text>

            {review ? (
                <>
                    <View style={styles.card}>
                        <View style={styles.starsRow}>
                            <LegendaryStars stars={review.stars} variant="badge" size={18} />
                        </View>

                        {hasColumns && (
                            <View style={[styles.body, twoColumn ? styles.bodyTwoCol : styles.bodyOneCol]}>
                                <View style={twoColumn ? styles.colLeft : undefined}>
                                    <View style={styles.bars}>
                                        {activeBars.map(({ key, label }) => {
                                            const val = ratings[key] as number
                                            return (
                                                <View key={key} style={styles.barLabeled}>
                                                    <View style={[styles.barFill, { width: `${(val / 10) * 100}%` }]} />
                                                    <Text style={styles.barLbl} numberOfLines={1}>{label}</Text>
                                                    <Text style={styles.barVal} numberOfLines={1}>{val}</Text>
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
                                                const showCount = b.hasCount && typeof val === 'number' && val > 1
                                                return (
                                                    <View key={b.id} style={styles.badge}>
                                                        <View style={[styles.badgeCircle, { borderColor: b.color }]}>
                                                            <Text style={{ color: b.color, fontSize: showCount ? 16 : 20, fontFamily: fonts.uiBold }}>
                                                                {showCount ? `×${val}` : '●'}
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

                    <Pressable style={styles.editBtn} onPress={openEditor}>
                        <Text style={styles.editBtnText}>Edit Review</Text>
                    </Pressable>
                </>
            ) : (
                <>
                    <Pressable style={styles.noReview} onPress={openEditor}>
                        <View style={styles.ctaRow}>
                            <Lucide name="square-pen" color={colors.accent} size={15} />
                            <Text style={styles.noReviewText}>Write a Review for this game</Text>
                        </View>
                    </Pressable>
                    <Pressable style={[styles.writeBtn, styles.ctaRow]} onPress={openEditor}>
                        <Lucide name="square-pen" color={colors.accent} size={14} />
                        <Text style={styles.writeBtnText}>Write a Review</Text>
                    </Pressable>
                </>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },

    // .rev-local-card — gold LEFT border only (no full border), bg-raised
    card: {
        backgroundColor: colors.bgRaised,
        borderLeftWidth: 3,
        borderLeftColor: '#c8a84b',
        borderRadius: radius,
        paddingVertical: 16,
        paddingHorizontal: 18,
        marginBottom: 16,
    },
    starsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },

    // .rev-local-body — 2 columns (bars | tags+badges), 32px gutter; single column at ≤479px
    body: { alignItems: 'flex-start', marginBottom: 16 },
    bodyTwoCol: { flexDirection: 'row', columnGap: 32 },
    bodyOneCol: { flexDirection: 'column', rowGap: 20 },
    colLeft: { flex: 1 },
    colRight: { flex: 1, gap: 12 },
    colRightStacked: { gap: 12, alignSelf: 'stretch' },

    // .rev-bars — 2-column grid of labeled bars; fill is an absolute background behind the labels
    bars: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 4 },
    barLabeled: {
        width: '48.5%', height: 22, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8,
    },
    barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#c8a84b', borderRadius: 3 },
    barLbl: {
        flexShrink: 1, color: '#fff', fontSize: 9, fontFamily: fonts.uiBold, textTransform: 'uppercase',
        letterSpacing: 0.45, textShadowColor: 'rgba(0,0,0,0.65)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
    },
    barVal: {
        flexShrink: 0, marginLeft: 4, color: '#fff', fontSize: 9, fontFamily: fonts.uiBold,
        textShadowColor: 'rgba(0,0,0,0.65)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
    },

    // .rev-tags-row / .rev-tag-pill
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tagPill: {
        color: '#c8a84b', fontFamily: fonts.ui, fontSize: 11, lineHeight: 15, borderWidth: 1, borderColor: 'rgba(200,168,75,0.4)',
        backgroundColor: 'rgba(200,168,75,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
    },

    // .rev-badges-row / .rev-badge — 52px ring (icon SVGs not ported; colored ring + count/dot)
    badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    badge: { alignItems: 'center', gap: 6, width: 64 },
    badgeCircle: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
    badgeLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, lineHeight: 13, textAlign: 'center', textTransform: 'uppercase', maxWidth: 64 },

    // .rev-review-text
    reviewText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 14, lineHeight: 22 },
    reviewToggle: { color: '#c8a84b', fontFamily: fonts.uiBold, fontSize: 12, marginTop: 6 },

    // .rev-edit-btn — bordered pill BELOW the card
    editBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingVertical: 4, paddingHorizontal: 12 },
    editBtnText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },

    // .rev-no-review — full-width dashed CTA
    noReview: {
        width: '100%', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius,
        paddingVertical: 20, paddingHorizontal: 24, alignItems: 'center',
    },
    noReviewText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 14 },
    ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

    // .rev-write-btn — small pill below the CTA
    writeBtn: {
        alignSelf: 'flex-start', marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius,
        paddingVertical: 7, paddingHorizontal: 16,
    },
    writeBtnText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
})
