import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { colors, fonts, spacing } from '@/theme/tokens'

// Port of GameHero.svelte's `.update-badge--cells` — the live "content updating" indicator the web
// floats while Phase-2 sections (HLTB / prices / PCGW / ProtonDB / news / reviews) stream in. A
// dark-blue glass pill with a spinning loader + the count of sections still loading; when everything
// resolves it holds ~1200ms (so a fast load still flashes the confirmation) then fades out.
export function GameUpdateBadge({ sections }: { sections: string[] }) {
    const rot = useSharedValue(0)
    const [shown, setShown] = useState(false)
    const [done, setDone] = useState(false)

    useEffect(() => {
        rot.value = withRepeat(withTiming(360, { duration: 850, easing: Easing.linear }), -1)
    }, [rot])

    useEffect(() => {
        if (sections.length > 0) { setShown(true); setDone(false); return }
        if (!shown) return
        setDone(true)
        const t = setTimeout(() => setShown(false), 1200)
        return () => clearTimeout(t)
    }, [sections.length, shown])

    const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }))
    if (!shown) return null

    return (
        <Animated.View style={styles.badge}>
            {done ? (
                <Feather name="check" size={13} color="#7edb8a" />
            ) : (
                <Animated.View style={spin}><Feather name="loader" size={13} color="#7fb4e6" /></Animated.View>
            )}
            <Text style={styles.text}>
                {done ? 'Up to date' : `Updating ${sections.length} section${sections.length > 1 ? 's' : ''}…`}
            </Text>
        </Animated.View>
    )
}

const styles = StyleSheet.create({
    badge: {
        position: 'absolute',
        right: 14,
        bottom: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        backgroundColor: 'rgba(18,26,42,0.94)',
        borderWidth: 1,
        borderColor: 'rgba(127,180,230,0.35)',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
        zIndex: 30,
    },
    text: { color: '#cfe0f2', fontFamily: fonts.uiBold, fontSize: 12 },
})
