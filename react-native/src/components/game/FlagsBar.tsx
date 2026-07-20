import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { setGameFlag, setLocalWishlisted } from '@/api/gamePage'
import { colors } from '@/theme/tokens'
import type { GameFlags, FlagKey } from 'gaming-journal-contracts/flags'
import type { GameDetail } from 'gaming-journal-contracts/gameDetail'

// Port of FlagsBar.svelte. Individual PATCH per flag (optimistic, rolls back only on a network
// throw — NOT on a non-2xx response, ported faithfully from the real web behavior rather than
// "fixed"). Wishlist toggle is separate (POST to add / DELETE to remove) and DOES check res.ok.
//
// 2026-07-18 parity rework: web renders a compact ICON-ONLY toolbar (one glyph per flag, the label
// is a tooltip) — FlagsBar.svelte:15-36. This mirrors that with @expo/vector-icons glyphs closest to
// the web's Lucide outline SVGs; active/inactive is conveyed by icon colour (each flag keeps its own
// web accent) rather than a filled pill. Toggle behaviour + optimistic update are unchanged.
type IconSpec =
    | { set: 'feather'; name: keyof typeof Feather.glyphMap }
    | { set: 'mci'; name: keyof typeof MaterialCommunityIcons.glyphMap }

const INACTIVE = 'rgba(237,233,223,0.42)'

const GROUPS: { key: FlagKey; icon: IconSpec; color: string }[][] = [
    [{ key: 'software', icon: { set: 'mci', name: 'wrench-outline' }, color: '#e0a030' }],
    [
        { key: 'childLock', icon: { set: 'feather', name: 'lock' }, color: '#e05555' },
        { key: 'filtered', icon: { set: 'feather', name: 'eye-off' }, color: '#8888aa' },
        { key: 'alert', icon: { set: 'feather', name: 'bell' }, color: '#e0b830' },
    ],
    [
        { key: 'favorite', icon: { set: 'feather', name: 'heart' }, color: '#e05577' },
        { key: 'revisit', icon: { set: 'feather', name: 'rotate-ccw' }, color: '#40b0d0' },
    ],
    [
        { key: 'completed', icon: { set: 'mci', name: 'trophy-outline' }, color: colors.accent },
        { key: 'dropped', icon: { set: 'feather', name: 'x-circle' }, color: '#996655' },
        { key: 'inProgress', icon: { set: 'feather', name: 'pause-circle' }, color: '#d07830' },
        { key: 'backlog', icon: { set: 'feather', name: 'bookmark' }, color: '#7070d0' },
    ],
]

function FlagIcon({ icon, color, size = 17 }: { icon: IconSpec; color: string; size?: number }) {
    return icon.set === 'feather'
        ? <Feather name={icon.name} size={size} color={color} />
        : <MaterialCommunityIcons name={icon.name} size={size} color={color} />
}

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
    const isSteamWl = game.wishlist && typeof game.wishlist === 'object' && (game.wishlist as { steam?: boolean }).steam

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
                    {group.map(({ key, icon, color }) => {
                        const active = !!flags[key]
                        return (
                            <Pressable
                                key={key}
                                hitSlop={4}
                                style={styles.flagBtn}
                                onPress={() => toggleFlag(key)}
                            >
                                <FlagIcon icon={icon} color={active ? color : INACTIVE} />
                            </Pressable>
                        )
                    })}
                    {gi < GROUPS.length - 1 && <View style={styles.divider} />}
                </View>
            ))}

            {!isLibrary && (
                <>
                    <View style={styles.divider} />
                    {isSteamWl ? (
                        <View style={styles.flagBtn}>
                            <MaterialCommunityIcons name="star" size={17} color="#7aade0" />
                        </View>
                    ) : (
                        <Pressable hitSlop={4} style={styles.flagBtn} onPress={toggleWishlist}>
                            <MaterialCommunityIcons
                                name={wishlisted ? 'star' : 'star-outline'}
                                size={17}
                                color={wishlisted ? '#f5d132' : INACTIVE}
                            />
                        </Pressable>
                    )}
                </>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    bar: { borderBottomWidth: 1, borderBottomColor: colors.border },
    inner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
    group: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    divider: { width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: 8 },
    flagBtn: {
        width: 34,
        height: 34,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'transparent',
    },
})
