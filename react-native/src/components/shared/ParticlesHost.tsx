import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
    Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated'

import { Lucide } from '@/components/shared/Lucide'
import { useParticlesStore, type Burst, type Toast } from '@/store/particlesStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// Root-mounted overlay (see particlesStore.ts) — port of fireParticles() (src/lib/js/particles.ts).
// The web draws directly to a `<canvas>` with an imperative `requestAnimationFrame` physics loop;
// RN has no canvas-as-a-primitive equivalent (react-native-skia would add a real new dependency for
// one cosmetic effect). Instead: **the exact same deterministic physics are simulated once, up
// front, in plain JS** (same random distributions, same gravity/damping/decay constants as the
// real source), producing a per-particle array of sampled (x, y, rotation, opacity) keyframes. A
// single Reanimated `withTiming` drives one shared "frame" value linearly over the burst's real
// lifetime, and each particle's `useAnimatedStyle` looks up its own precomputed keyframes via
// `interpolate()` — genuinely the same trajectory shape the live web simulation produces (physics
// here have no per-frame randomness after spawn, so precomputing is equivalent, not an
// approximation), just computed once instead of stepped live, which sidesteps needing 90
// simultaneous UI-thread frame callbacks for a purely cosmetic effect.
const COLORS = ['#4ecdc4', '#c9a84c', '#ffe580', '#ffffff', '#b57bee', '#ff6b9d', '#7ef5ee']
const PARTICLE_COUNT = 90
const MAX_FRAMES = 130 // covers the real decay range (0.014–0.028/frame ⇒ life 1→0 in ~36–72 frames), with margin
const SAMPLE_EVERY = 3 // sample every 3rd simulated frame — visually identical at 60fps, 1/3 the interpolation points

type ParticleFrames = {
    color: string
    isRect: boolean
    size: number
    w: number
    h: number
    xs: number[]
    ys: number[]
    rots: number[]
    opacities: number[]
    deathSampleIdx: number
}

function simulateParticle(): ParticleFrames {
    const angle = Math.random() * Math.PI * 2
    const speed = 3 + Math.random() * 9
    const isRect = Math.random() > 0.45
    let x = 0, y = 0
    let vx = Math.cos(angle) * speed
    let vy = Math.sin(angle) * speed - 2.5
    let life = 1
    let rot = Math.random() * Math.PI * 2
    const rotV = (Math.random() - 0.5) * 0.28
    const decay = 0.014 + Math.random() * 0.014

    const xs: number[] = [], ys: number[] = [], rots: number[] = [], opacities: number[] = []
    let deathSampleIdx = Math.floor(MAX_FRAMES / SAMPLE_EVERY)
    let dead = false
    for (let f = 0; f <= MAX_FRAMES; f++) {
        if (f % SAMPLE_EVERY === 0) {
            xs.push(x); ys.push(y); rots.push(rot); opacities.push(Math.max(0, life))
            if (!dead && life <= 0) { deathSampleIdx = xs.length - 1; dead = true }
        }
        x += vx; y += vy
        vy += 0.22
        vx *= 0.985
        life -= decay
        rot += rotV
    }

    return {
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        isRect,
        size: isRect ? 0 : 3 + Math.random() * 4,
        w: isRect ? 5 + Math.random() * 5 : 0,
        h: isRect ? 2 + Math.random() * 3 : 0,
        xs, ys, rots, opacities,
        deathSampleIdx,
    }
}

function ParticleBurst({ burst, onDone }: { burst: Burst; onDone: () => void }) {
    const particles = useMemo(() => Array.from({ length: PARTICLE_COUNT }, simulateParticle), [])
    const frame = useSharedValue(0)
    const totalSamples = Math.floor(MAX_FRAMES / SAMPLE_EVERY)

    useEffect(() => {
        frame.value = withTiming(totalSamples, { duration: (MAX_FRAMES / 60) * 1000, easing: Easing.linear }, (finished) => {
            if (finished) runOnJS(onDone)()
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per burst instance
    }, [])

    return (
        <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
            {particles.map((p, i) => (
                <Particle key={i} p={p} frame={frame} originX={burst.x} originY={burst.y} totalSamples={totalSamples} />
            ))}
        </View>
    )
}

function Particle({ p, frame, originX, originY, totalSamples }: {
    p: ParticleFrames
    frame: SharedValue<number>
    originX: number
    originY: number
    totalSamples: number
}) {
    const indices = useMemo(() => Array.from({ length: totalSamples + 1 }, (_, i) => i), [totalSamples])

    const style = useAnimatedStyle(() => {
        const x = interpolate(frame.value, indices, p.xs)
        const y = interpolate(frame.value, indices, p.ys)
        const rot = interpolate(frame.value, indices, p.rots)
        const opacity = frame.value >= p.deathSampleIdx ? 0 : interpolate(frame.value, indices, p.opacities)
        return {
            opacity,
            transform: [
                { translateX: originX + x }, { translateY: originY + y }, { rotate: `${rot}rad` },
            ],
        }
    })

    return (
        <Animated.View
            style={[
                styles.particleBase,
                p.isRect
                    ? { width: p.w, height: p.h, backgroundColor: p.color }
                    : { width: p.size * 2, height: p.size * 2, borderRadius: p.size, backgroundColor: p.color },
                style,
            ]}
        />
    )
}

function ToastItem({ toast, index, onDone }: { toast: Toast; index: number; onDone: () => void }) {
    // Port of _showToast(): slide in from the right (translateX 120%→0, opacity 0→1), hold, slide
    // back out. The web stacks concurrent toasts 56px apart (bottom offset); matched here via `index`.
    const progress = useSharedValue(0)

    useEffect(() => {
        progress.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.back(1.4)) })
        const hold = setTimeout(() => {
            progress.value = withTiming(0, { duration: 250 }, (finished) => {
                if (finished) runOnJS(onDone)()
            })
        }, 3200)
        return () => clearTimeout(hold)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per toast instance
    }, [])

    const style = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ translateX: (1 - progress.value) * 200 }],
    }))

    return (
        <Animated.View style={[styles.toast, { bottom: 24 + index * 56 }, style]}>
            <View style={styles.toastRow}>
                <Lucide name="party-popper" color={colors.sage} size={15} />
                <Animated.Text style={styles.toastText}>{toast.label} complete!</Animated.Text>
            </View>
        </Animated.View>
    )
}

export function ParticlesHost() {
    const bursts = useParticlesStore(s => s.bursts)
    const toasts = useParticlesStore(s => s.toasts)
    const removeBurst = useParticlesStore(s => s.removeBurst)
    const removeToast = useParticlesStore(s => s.removeToast)

    return (
        <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
            {bursts.map(b => <ParticleBurst key={b.id} burst={b} onDone={() => removeBurst(b.id)} />)}
            {toasts.map((t, i) => <ToastItem key={t.id} toast={t} index={i} onDone={() => removeToast(t.id)} />)}
        </View>
    )
}

const styles = StyleSheet.create({
    particleBase: { position: 'absolute', top: 0, left: 0 },
    toast: {
        position: 'absolute', right: spacing.lg,
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.accent, borderRadius: radius,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 16,
    },
    toastRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    toastText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
})
