import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
    Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated'

// Port of GuideLanding.svelte's cover-image mosaic. Same 3D-flip TECHNIQUE as the shared
// `FlipMosaic` component (rotateX/rotateY + backfaceVisibility, genuinely translates to RN) but
// deliberately NOT a reuse of that component: FlipMosaic always wraps each tile in a `<Link
// href="/game/{appid}">`, while the guide mosaic's tiles are purely decorative (confirmed in the
// source — no onclick anywhere on `.gl-mosaic-cell`), and the interval differs (5000ms here vs
// FlipMosaic's 8000ms). Forcing one generic component to cover "sometimes a Link, sometimes not,
// with a different appid/section identity shape" risked destabilizing the 3 already-verified
// FlipMosaic call sites for a comparatively small amount of shared logic — a documented, deliberate
// duplication, not an oversight.
export type MosaicImage = { key: string; url: string }

const INTERVAL_MS = 5000
const FLIP_MS = 650

type Slot = { front: MosaicImage; back: MosaicImage; axis: 'X' | 'Y'; delay: number; flipKey: number }

function shuffle<T>(arr: T[]): T[] {
    const copy = [...arr]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
}

export function GuideMosaic({ images }: { images: MosaicImage[] }) {
    const [slots, setSlots] = useState<Slot[]>([])
    const allImages = useRef<MosaicImage[]>([])

    useEffect(() => {
        if (images.length < 6) { setSlots([]); return }
        allImages.current = [...images]
        const initial = shuffle(images).slice(0, 6)
        setSlots(initial.map(img => ({ front: img, back: img, axis: 'Y', delay: 0, flipKey: 0 })))

        const interval = setInterval(tick, INTERVAL_MS)
        return () => clearInterval(interval)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-arm when the images identity changes, matching the web's $effect(coverImages)
    }, [images])

    function tick() {
        setSlots(current => {
            if (!current.length) return current
            // Shuffle all images, pick 6, ensure no slot gets its current front image again —
            // ported verbatim from tick()'s swap-with-neighbor guarantee.
            const pool = shuffle(allImages.current).slice(0, 6)
            for (let i = 0; i < pool.length; i++) {
                if (pool[i].url === current[i].front.url) {
                    const j = (i + 1) % pool.length
                    ;[pool[i], pool[j]] = [pool[j], pool[i]]
                }
            }
            return current.map((slot, i) => ({
                front: slot.front,
                back: pool[i],
                axis: Math.random() < 0.5 ? 'X' : 'Y',
                delay: Math.floor(Math.random() * 450),
                flipKey: slot.flipKey + 1,
            }))
        })
    }

    function onFlipEnd(index: number) {
        setSlots(current => {
            const slot = current[index]
            if (!slot) return current
            const next = [...current]
            next[index] = { front: slot.back, back: slot.back, axis: slot.axis, delay: 0, flipKey: slot.flipKey }
            return next
        })
    }

    if (images.length < 6 || slots.length < 6) return null

    return (
        <View style={styles.grid}>
            {slots.map((slot, i) => (
                <View key={i} style={styles.cellWrap}>
                    <MosaicCell slot={slot} index={i} onFlipEnd={onFlipEnd} />
                </View>
            ))}
        </View>
    )
}

function MosaicCell({ slot, index, onFlipEnd }: { slot: Slot; index: number; onFlipEnd: (i: number) => void }) {
    const rotation = useSharedValue(0)
    const isFlipping = slot.front.url !== slot.back.url

    useEffect(() => {
        if (!isFlipping) return
        rotation.value = 0
        rotation.value = withDelay(
            slot.delay,
            withTiming(180, { duration: FLIP_MS, easing: Easing.bezier(0.4, 0, 0.2, 1) }, (finished) => {
                if (finished) runOnJS(onFlipEnd)(index)
            }),
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slot.flipKey])

    const axisKey = slot.axis === 'X' ? 'rotateX' : 'rotateY'
    const frontStyle = useAnimatedStyle(() => ({ transform: [{ perspective: 1000 }, { [axisKey]: `${rotation.value}deg` }] as never }))
    const backStyle = useAnimatedStyle(() => ({ transform: [{ perspective: 1000 }, { [axisKey]: `${rotation.value - 180}deg` }] as never }))

    return (
        <View style={styles.cell}>
            <Animated.View style={[styles.face, frontStyle]}>
                <Image source={{ uri: slot.front.url }} style={styles.image} contentFit="cover" />
            </Animated.View>
            <Animated.View style={[styles.face, backStyle]}>
                <Image source={{ uri: slot.back.url }} style={styles.image} contentFit="cover" />
            </Animated.View>
        </View>
    )
}

const styles = StyleSheet.create({
    grid: { flex: 1, minHeight: 0, flexDirection: 'row', flexWrap: 'wrap' },
    cellWrap: { width: '33.333%', height: '50%' },
    cell: { flex: 1, margin: 2, overflow: 'hidden' },
    face: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backfaceVisibility: 'hidden' },
    image: { width: '100%', height: '100%' },
})
