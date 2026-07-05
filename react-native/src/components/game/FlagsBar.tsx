import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { setGameFlag, setLocalWishlisted } from '@/api/gamePage'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { GameFlags, FlagKey } from 'gaming-journal-contracts/flags'
import type { GameDetail } from 'gaming-journal-contracts/gameDetail'

// Port of FlagsBar.svelte. Individual PATCH per flag (optimistic, rolls back only on a network
// throw — NOT on a non-2xx response, ported faithfully from the real web behavior rather than
// "fixed"). Wishlist toggle is separate (POST to add / DELETE to remove) and DOES check res.ok.
const GROUPS: { key: FlagKey; label: string }[][] = [
    [{ key: 'software', label: 'Software' }],
    [{ key: 'childLock', label: 'Child Lock' }, { key: 'filtered', label: 'Filtered' }, { key: 'alert', label: 'Sale Alert' }],
    [{ key: 'favorite', label: 'Favorite' }, { key: 'revisit', label: 'Revisit' }],
    [{ key: 'completed', label: 'Completed' }, { key: 'dropped', label: 'Dropped' }, { key: 'inProgress', label: 'In Progress' }, { key: 'backlog', label: 'Backlog' }],
]

export function FlagsBar({
    appid, game, initialFlags, localWishlisted,
}: {
    appid: number
    game: GameDetail
    initialFlags: GameFlags
    localWishlisted: boolean
}) {
    const [flags, setFlags] = useState(initialFlags)
    const [wishlisted, setWishlisted] = useState(localWishlisted)
    const isLibrary = game.source === 'library' || game.source === 'both'

    async function toggleFlag(key: FlagKey) {
        const prev = !!flags[key]
        setFlags(f => ({ ...f, [key]: !prev }))
        try {
            await setGameFlag(appid, key, !prev)
        } catch {
            setFlags(f => ({ ...f, [key]: prev }))
        }
    }

    async function toggleWishlist() {
        const was = wishlisted
        setWishlisted(!was)
        const ok = await setLocalWishlisted(appid, !was).catch(() => false)
        if (!ok) setWishlisted(was)
    }

    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.inner}>
            {GROUPS.map((group, gi) => (
                <View key={gi} style={styles.group}>
                    {group.map(({ key, label }) => (
                        <Pressable
                            key={key}
                            style={StyleSheet.flatten([styles.chip, flags[key] && styles.chipActive])}
                            onPress={() => toggleFlag(key)}
                        >
                            <Text style={[styles.chipText, flags[key] && styles.chipTextActive]}>{label}</Text>
                        </Pressable>
                    ))}
                    {gi < GROUPS.length - 1 && <View style={styles.divider} />}
                </View>
            ))}
            {!isLibrary && (
                <>
                    <View style={styles.divider} />
                    {game.wishlist && typeof game.wishlist === 'object' && (game.wishlist as { steam?: boolean }).steam ? (
                        <View style={StyleSheet.flatten([styles.chip, styles.chipActive, styles.chipDisabled])}>
                            <Text style={[styles.chipText, styles.chipTextActive]}>★ On Steam Wishlist</Text>
                        </View>
                    ) : (
                        <Pressable
                            style={StyleSheet.flatten([styles.chip, wishlisted && styles.chipActive])}
                            onPress={toggleWishlist}
                        >
                            <Text style={[styles.chipText, wishlisted && styles.chipTextActive]}>
                                {wishlisted ? '★ Wishlisted' : '☆ Wishlist'}
                            </Text>
                        </Pressable>
                    )}
                </>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    bar: { borderBottomWidth: 1, borderBottomColor: colors.border },
    inner: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.xs },
    group: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    divider: { width: 1, height: 18, backgroundColor: colors.border, marginHorizontal: spacing.xs },
    chip: {
        borderWidth: 1, borderColor: colors.border, borderRadius: radius,
        paddingHorizontal: spacing.sm, paddingVertical: 5, backgroundColor: colors.bgRaised,
    },
    chipActive: { borderColor: colors.borderAct, backgroundColor: colors.accentBg },
    chipDisabled: { opacity: 0.7 },
    chipText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    chipTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
})
