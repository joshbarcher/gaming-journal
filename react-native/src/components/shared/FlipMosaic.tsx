import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { getFlags } from '@/api/flags'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
} from 'react-native-reanimated'

// Port of src/lib/svelte/home/HomeMosaic.svelte — the single most-repeated "hard to port" visual
// in the whole app (7 call sites per the original feature audit: guides landing, game hero,
// favorites hero, franchise hero+mosaic, home x3). Built once here, reused everywhere.
//
// Timing/easing ported exactly from public/css/home.css: 650ms flip, cubic-bezier(0.4, 0, 0.2, 1),
// 8s interval between flips, 0-450ms random per-tile stagger, images preloaded 2s into a flip.
// The 3D flip itself DOES translate directly to RN — rotateX/rotateY transforms and
// backfaceVisibility: 'hidden' are both real RN style properties, not a web-only trick.
export type MosaicPoster = { appid: number; poster: string }

const INTERVAL_MS   = 8000
const FLIP_MS       = 650
const PRELOAD_AT_MS = 2000
const EASING        = Easing.bezier(0.4, 0, 0.2, 1)

type Slot = {
    front: MosaicPoster
    back:  MosaicPoster
    axis:  'X' | 'Y'
    delay: number
    flipKey: number // bump to retrigger the animation effect even if axis/delay repeat by chance
}

function shuffle<T>(arr: T[]): T[] {
    const copy = [...arr]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
}

export function FlipMosaic({ posters, cols = 3 }: { posters: MosaicPoster[]; cols?: 2 | 3 }) {
    const [slots, setSlots] = useState<Slot[]>([])
    const available = useRef<MosaicPoster[]>([])
    const preloaded = useRef(new Set<string>())

    function preload(items: MosaicPoster[]) {
        for (const p of items) {
            if (preloaded.current.has(p.poster)) continue
            preloaded.current.add(p.poster)
            Image.prefetch(p.poster).catch(() => {})
        }
    }

    useEffect(() => {
        if (posters.length < 12) return

        const copy = shuffle(posters)
        setSlots(copy.slice(0, 6).map(p => ({ front: p, back: p, axis: 'Y', delay: 0, flipKey: 0 })))
        available.current = copy.slice(6)
        preload(available.current.slice(0, 12))

        const interval = setInterval(tick, INTERVAL_MS)
        return () => clearInterval(interval)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the Svelte $effect: only
        // re-runs when the posters identity changes, not on every internal slot/available mutation.
    }, [posters])

    function tick() {
        setSlots(currentSlots => {
            if (available.current.length < 6) return currentSlots

            const frontPosters = new Set(currentSlots.map(s => s.front.poster))
            const eligible = available.current.filter(p => !frontPosters.has(p.poster))
            const source = eligible.length >= 6 ? eligible : available.current

            const pool = shuffle(source)
            const picked = pool.slice(0, 6)
            const pickedSet = new Set(picked.map(p => p.poster))
            available.current = available.current.filter(p => !pickedSet.has(p.poster))

            setTimeout(() => preload(available.current.slice(0, 12)), PRELOAD_AT_MS)

            return currentSlots.map((slot, i) => ({
                front: slot.front,
                back:  picked[i],
                axis:  Math.random() < 0.5 ? 'X' : 'Y',
                delay: Math.floor(Math.random() * 450),
                flipKey: slot.flipKey + 1,
            }))
        })
    }

    function onFlipEnd(index: number) {
        setSlots(currentSlots => {
            const slot = currentSlots[index]
            if (!slot) return currentSlots
            available.current = [...available.current, slot.front]
            const next = [...currentSlots]
            next[index] = { front: slot.back, back: slot.back, axis: slot.axis, delay: 0, flipKey: slot.flipKey }
            return next
        })
    }

    if (posters.length < 12) return null

    const rows = cols === 2 ? 3 : 2
    return (
        <View style={[styles.grid, { flexDirection: 'row', flexWrap: 'wrap' }]}>
            {slots.map((slot, i) => (
                <View key={i} style={{ width: `${100 / cols}%`, height: `${100 / rows}%` }}>
                    <MosaicCell slot={slot} index={i} onFlipEnd={onFlipEnd} />
                </View>
            ))}
        </View>
    )
}

function MosaicCell({ slot, index, onFlipEnd }: { slot: Slot; index: number; onFlipEnd: (i: number) => void }) {
    const rotation = useSharedValue(0)
    const isFlipping = slot.front.poster !== slot.back.poster
    // Every mosaic tile links to /game/{appid}, so it gets the same long-press game-card menu as
    // every other info-linking card. Flags come from the shared ['flags'] cache (no extra fetch).
    const flags = useQuery({ queryKey: ['flags'], queryFn: getFlags }).data?.[slot.front.appid]

    useEffect(() => {
        if (!isFlipping) return
        rotation.value = 0
        rotation.value = withDelay(
            slot.delay,
            withTiming(180, { duration: FLIP_MS, easing: EASING }, (finished) => {
                if (finished) runOnJS(onFlipEnd)(index)
            }),
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slot.flipKey])

    const axisKey = slot.axis === 'X' ? 'rotateX' : 'rotateY'

    const frontStyle = useAnimatedStyle(() => ({
        transform: [{ perspective: 1000 }, { [axisKey]: `${rotation.value}deg` }] as never,
    }))
    const backStyle = useAnimatedStyle(() => ({
        transform: [{ perspective: 1000 }, { [axisKey]: `${rotation.value - 180}deg` }] as never,
    }))

    return (
        <Link href={`/game/${slot.front.appid}` as never} asChild>
            <Pressable
                style={styles.cell}
                onLongPress={(e) => openGameCardMenu(slot.front.appid, flags, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            >
                <Animated.View style={[styles.face, frontStyle]}>
                    <Image source={{ uri: slot.front.poster }} style={styles.image} contentFit="cover" />
                </Animated.View>
                <Animated.View style={[styles.face, backStyle]}>
                    <Image source={{ uri: slot.back.poster }} style={styles.image} contentFit="cover" />
                </Animated.View>
            </Pressable>
        </Link>
    )
}

const styles = StyleSheet.create({
    grid: {
        width:  '100%',
        height: '100%',
    },
    cell: {
        flex:     1,
        margin:   2,
        overflow: 'hidden',
    },
    face: {
        position:           'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backfaceVisibility: 'hidden',
    },
    image: {
        width:  '100%',
        height: '100%',
    },
})
