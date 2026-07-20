import { Pressable, StyleSheet, Text, View } from 'react-native'

import { fmtExpiry } from '@/api/pin'
import { Lucide } from '@/components/shared/Lucide'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { PinState } from 'gaming-journal-contracts/pin'

// Port of CommunityPage.svelte's pin indicator (community.md "Pin integration"). Live = pinned +
// active session; Grace = pinned + session recently ended; Manual = pinned via the button here,
// no session involved.
export function PinBadge({
    isPinned, isLive, isGrace, pin, onToggle,
}: {
    isPinned: boolean
    isLive:   boolean
    isGrace:  boolean
    pin:      PinState | null
    onToggle: () => void
}) {
    if (isLive) {
        return (
            <View style={[styles.badge, styles.badgeLive]}>
                <View style={styles.liveDot} />
                <Text style={styles.labelLive}>Live</Text>
            </View>
        )
    }
    if (isGrace || isPinned) {
        return (
            <View style={[styles.badge, styles.badgePinned]}>
                <Lucide name="pin" color={colors.accent} size={12} />
                <Text style={styles.label}>Pinned{pin ? ` · ${fmtExpiry(pin.expiresAt)}` : ''}</Text>
                <Pressable onPress={onToggle} hitSlop={8}><Text style={styles.unpin}>×</Text></Pressable>
            </View>
        )
    }
    return (
        <Pressable style={styles.pinBtn} onPress={onToggle}>
            <Lucide name="pin" color={colors.iconMuted} size={12} />
            <Text style={styles.pinBtnText}>Pin</Text>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    badge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius,
    },
    badgeLive:    { backgroundColor: 'rgba(126,219,138,0.12)' },
    badgePinned:  { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    liveDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#7edb8a' },
    labelLive:    { color: '#7edb8a', fontFamily: fonts.uiBold, fontSize: 11 },
    label:        { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11 },
    icon:         { fontSize: 12 },
    iconMuted:    { fontSize: 12, opacity: 0.6 },
    unpin:        { color: colors.textMuted, fontSize: 14, paddingHorizontal: 2 },
    pinBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius,
        borderWidth: 1, borderColor: colors.border,
    },
    pinBtnText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11 },
})
