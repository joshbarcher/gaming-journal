import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { useApiHost } from '@/hooks/useApiHost'

// Port of the hero crossfade slideshow used by Favorites/game-page/franchises (per the original
// feature audit, these three all share "the same two-div alternating opacity pattern as
// GameHero" — a genuinely different component from FlipMosaic, which does 3D rotation flips for
// Home/guides-landing/franchise-mosaic. Building this here since Favorites needs it first.
//
// Screenshot discovery is a real probe, not a data field: the web version tries loading
// `/relay/images/steam/screenshots/{appid}/{i}.jpg` for i=0..19 and keeps whichever succeed
// (`new Image()` + onload/onerror) — read directly from Favorites.svelte, since there's no API
// endpoint listing available screenshots. Ported using `Image.prefetch()`, which resolves `false`
// (not a rejection) on failure — same non-throwing existence-check semantics.
//
// Deliberately NOT ported: the web version's slow "Ken Burns" background-position pan (10s linear
// pan toward a random top/bottom edge) layered under the 1.5s opacity crossfade. The crossfade
// itself (the actual "slideshow" behavior the doc describes) is ported exactly; the pan is a
// cosmetic embellishment on top of it, skipped to keep this component's scope to the core behavior
// — same kind of deliberate simplification as Backlog's Random Pick highlight (no pulse animation).
const INTERVAL_MS = 14000
const FADE_MS = 1500

// Franchise.svelte's hero is the same two-div alternating-opacity pattern but with genuinely
// different constants (6s interval, 1.8s fade — confirmed in franchises.css's
// `.frc-hero-bg { transition: opacity 1.8s ease }` and the source's `setInterval(..., 6000)`) and a
// different frame source: it already has every entry's `media.screenshots` from the games list it
// loaded anyway, so there's no per-appid probing step — the caller passes `frames` directly instead
// of an `appid` to probe. Both modes share the same crossfade engine below.
type Props =
    | { appid: number; frames?: undefined; intervalMs?: number; fadeMs?: number }
    | { appid?: undefined; frames: string[]; intervalMs?: number; fadeMs?: number }

export function HeroCrossfade({ appid, frames: providedFrames, intervalMs = INTERVAL_MS, fadeMs = FADE_MS }: Props) {
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const [frames, setFrames] = useState<string[]>(providedFrames ?? [])
    const frameIndex = useRef(0)
    const [layerA, setLayerA] = useState<string | null>(null)
    const [layerB, setLayerB] = useState<string | null>(null)
    const showingA = useRef(true)
    const opacityA = useSharedValue(1)
    const opacityB = useSharedValue(0)

    useEffect(() => {
        if (providedFrames) {
            setFrames(providedFrames)
            setLayerA(providedFrames[0] ?? null)
            frameIndex.current = 1
            return
        }
        if (!apiHost || appid == null) return
        let cancelled = false

        ;(async () => {
            const candidates = Array.from({ length: 20 }, (_, i) => `${apiHost}/relay/images/steam/screenshots/${appid}/${i}.jpg`)
            const results = await Promise.all(
                candidates.map(async (url) => ((await Image.prefetch(url).catch(() => false)) ? url : null)),
            )
            if (cancelled) return
            const screenshots = results.filter((u): u is string => u !== null)
            const headerUrl = `${apiHost}/relay/images/steam/games/${appid}/header.jpg`
            const shuffled = [...screenshots].sort(() => Math.random() - 0.5)
            const finalFrames = shuffled.length ? [...shuffled, headerUrl] : [headerUrl]
            setFrames(finalFrames)
            setLayerA(finalFrames[0])
            frameIndex.current = 1
        })()

        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- providedFrames is a stable prop identity check, not a dep to re-probe on
    }, [apiHost, appid, providedFrames])

    useEffect(() => {
        if (frames.length < 2) return // matches web: a single frame just repeats, no crossfade needed
        const interval = setInterval(() => {
            const url = frames[frameIndex.current % frames.length]
            frameIndex.current++
            if (showingA.current) {
                setLayerB(url)
                opacityB.value = withTiming(1, { duration: fadeMs })
                opacityA.value = withTiming(0, { duration: fadeMs })
            } else {
                setLayerA(url)
                opacityA.value = withTiming(1, { duration: fadeMs })
                opacityB.value = withTiming(0, { duration: fadeMs })
            }
            showingA.current = !showingA.current
        }, intervalMs)
        return () => clearInterval(interval)
    }, [frames, intervalMs, fadeMs])

    const styleA = useAnimatedStyle(() => ({ opacity: opacityA.value }))
    const styleB = useAnimatedStyle(() => ({ opacity: opacityB.value }))

    return (
        <>
            <Animated.View style={[StyleSheet.absoluteFill, styleA]}>
                {layerA && <Image source={{ uri: layerA }} style={StyleSheet.absoluteFill} contentFit="cover" />}
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styleB]}>
                {layerB && <Image source={{ uri: layerB }} style={StyleSheet.absoluteFill} contentFit="cover" />}
            </Animated.View>
        </>
    )
}
