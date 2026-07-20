import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { useQuery } from '@tanstack/react-query'

import { getFlags } from '@/api/flags'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { colors, fonts } from '@/theme/tokens'
import { fmt } from '@/utils/calendarRender'

// Shared tile for both CalendarGridCell (desktop/tablet month grid, primary=poster.jpg) and
// CalendarDayCard (mobile day list, primary=header.jpg) — the two real web components
// (CalendarCell.svelte / CalendarMonth.svelte's phone branch) use the SAME entry markup with
// only the image-fallback order swapped, so `primaryPath`/`fallbackPath` are passed in rather
// than hardcoded here.
export function CalendarEntryTile({
    appid, name, isRelease, durationMin, isLive, lastPlayed, apiHost, primaryPath, fallbackPath,
    style, overflow,
}: {
    appid:        number
    name:         string
    isRelease:    boolean
    durationMin:  number
    isLive:       boolean
    lastPlayed:   boolean
    apiHost:      string | undefined
    primaryPath:  string
    fallbackPath: string
    style?:       StyleProp<ViewStyle>
    overflow?:    number
}) {
    const [useFallback, setUseFallback] = useState(false)
    const [hidden, setHidden] = useState(false)
    useEffect(() => { setUseFallback(false); setHidden(false) }, [primaryPath, fallbackPath])

    const flatStyle = StyleSheet.flatten([styles.tile, style])
    const uri = apiHost ? `${apiHost}${useFallback ? fallbackPath : primaryPath}` : undefined
    // Calendar tiles link to /game/{appid}, so they get the same long-press game-card menu.
    const flags = useQuery({ queryKey: ['flags'], queryFn: getFlags }).data?.[appid]

    return (
        <Link href={`/game/${appid}` as never} asChild>
            <Pressable
                style={flatStyle}
                onLongPress={(e) => openGameCardMenu(appid, flags, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            >
                {uri && !hidden && (
                    <Image
                        source={{ uri }}
                        style={styles.img}
                        contentFit="cover"
                        onError={() => (useFallback ? setHidden(true) : setUseFallback(true))}
                    />
                )}
                {isRelease ? (
                    <View style={styles.overlay}>
                        <Text style={[styles.tag, styles.tagRelease]} numberOfLines={1}>REL</Text>
                    </View>
                ) : (
                    <View style={[styles.overlay, lastPlayed && !isLive && styles.overlayLastPlayed]}>
                        {isLive && <LiveDot />}
                        <Text
                            style={[styles.tag, isLive && styles.tagLive, lastPlayed && !isLive && styles.tagLastPlayed]}
                            numberOfLines={1}
                        >
                            {lastPlayed && !isLive ? 'last played' : fmt(durationMin)}
                        </Text>
                    </View>
                )}
                {!!overflow && <View style={styles.overflowBadge}><Text style={styles.overflowText}>+{overflow}</Text></View>}
            </Pressable>
        </Link>
    )
}

function LiveDot() {
    const pulse = useSharedValue(1)
    useEffect(() => {
        pulse.value = withRepeat(withSequence(withTiming(0.4, { duration: 700 }), withTiming(1, { duration: 700 })), -1, true)
    }, [pulse])
    const animStyle = useAnimatedStyle(() => ({ opacity: pulse.value, transform: [{ scale: 0.7 + pulse.value * 0.3 }] }))
    return <Animated.View style={[styles.liveDot, animStyle]} />
}

const styles = StyleSheet.create({
    tile: {
        position:       'relative',
        overflow:       'hidden',
        backgroundColor: colors.bgHover,
        borderRadius:   4,
    },
    img: { width: '100%', height: '100%' },
    overlay: {
        position:        'absolute',
        left: 0, right: 0, bottom: 0,
        paddingHorizontal: 4, paddingBottom: 3, paddingTop: 10,
        backgroundColor: 'rgba(0,0,0,0.55)',
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'flex-end',
        gap:             3,
    },
    overlayLastPlayed: { backgroundColor: 'rgba(10,15,30,0.6)' },
    tag: {
        fontSize:   9,
        color:      'rgba(255,255,255,0.9)',
        fontFamily: fonts.uiBold,
    },
    tagRelease: { color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
    tagLive:    { color: '#7edb8a' },
    tagLastPlayed: { color: 'rgba(160,175,200,0.8)', fontStyle: 'italic' },
    liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#7edb8a' },
    overflowBadge: {
        position:        'absolute',
        top: 3, left: 3,
        backgroundColor: 'rgba(0,0,0,0.7)',
        borderRadius:    3,
        paddingHorizontal: 3, paddingVertical: 1,
    },
    overflowText: { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
})
