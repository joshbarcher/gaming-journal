import { StyleSheet, Text, View } from 'react-native'

import { fonts } from '@/theme/tokens'

// Unifies two of the three independent star-rendering implementations found across the app:
// LocalReviewCard.svelte (game/reviews.md) and Favorites.svelte's inline starStr() (already ported
// into favorites.tsx as a 2nd/3rd copy of the same rule, flagged there as a unification candidate).
// Colors ported from local-review.css's --rev-accent (#c8a84b active / muted gray inactive).
//
// A third variant, 'card', was added for MyReviews.svelte (account/my-reviews.md, Phase 6) once
// that screen was actually built — confirmed by reading MyReviews.svelte directly: it uses a
// genuinely different display rule from 'badge'/'compact' — filled-stars-only with NO ☆ padding,
// `Array.from({ length: Math.min(stars, 6) }, ...)` (exactly `stars` icons, never padded to 5),
// and ✦ rendered as a literal 6th inline icon in the same row for Legendary, not a separate badge.
//
// 'badge'/'compact': Legendary is stars === 6, always displayed as 5 filled gold stars + a marker
// — never a literal 6th star glyph in the row (see memory: feedback_local_review_layout.md). This
// rule does NOT apply to 'card' — that one intentionally shows a real 6th icon.
export type LegendaryStarsVariant = 'badge' | 'compact' | 'card'

const ACTIVE_COLOR = '#c8a84b'
const INACTIVE_COLOR = '#888899'

export function LegendaryStars({
    stars, variant = 'badge', size = 14,
}: {
    stars: number | null | undefined
    variant?: LegendaryStarsVariant
    size?: number
}) {
    if (!stars) return null
    const isLegendary = stars >= 6

    if (variant === 'card') {
        const count = Math.min(stars, 6)
        return (
            <Text style={{ fontSize: size, letterSpacing: 1 }}>
                {Array.from({ length: count }, (_, i) => i + 1).map(i => (
                    <Text key={i} style={{ color: ACTIVE_COLOR }}>{i === 6 ? '✦' : '★'}</Text>
                ))}
            </Text>
        )
    }

    const displayStars = isLegendary ? 5 : stars

    return (
        <View style={styles.row}>
            <Text style={{ fontSize: size, letterSpacing: 2 }}>
                {Array.from({ length: 5 }, (_, i) => (
                    <Text key={i} style={{ color: i < displayStars ? ACTIVE_COLOR : INACTIVE_COLOR }}>
                        {i < displayStars ? '★' : '☆'}
                    </Text>
                ))}
            </Text>
            {isLegendary && variant === 'badge' && (
                <View style={styles.badge}>
                    <Text style={styles.badgeText}>✦ Legendary</Text>
                </View>
            )}
            {isLegendary && variant === 'compact' && (
                <Text style={[styles.compactMarker, { fontSize: size }]}> ✦</Text>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    // The web's gradient badge background (linear-gradient) isn't ported 1:1 — no gradient
    // dependency exists yet in this app — approximated with the gradient's midpoint solid color
    // (#f0c040), a deliberate simplification of a cosmetic detail, not the semantic behavior.
    badge: {
        backgroundColor: '#f0c040', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3,
    },
    badgeText: {
        color: '#1a1208', fontFamily: fonts.uiBold, fontSize: 9,
        letterSpacing: 1, textTransform: 'uppercase',
    },
    compactMarker: { color: ACTIVE_COLOR, fontFamily: fonts.ui },
})
