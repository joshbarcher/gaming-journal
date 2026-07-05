import MaskedView from '@react-native-masked-view/masked-view'
import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

// Port of guide-viewer.css's `.gl-title` shimmer — a user-loved effect (see memory:
// feedback_ui_shimmer_text.md — "Absolutely love the shimmer + colors"), so worth porting exactly
// rather than approximating with a simpler color pulse.
//
// Exact color stops and 5s linear timing ported from the real CSS, not invented: warm cream base
// (#e0d8c0) with a narrow gold band (#b8962e → #c9a84c → #fde97a → #c9a84c → #b8962e) centered in
// the gradient, `background-size:400%` sweeping left→right so both animation endpoints land on
// cream-only territory (a seamless loop) — confirmed against `public/css/guide-viewer.css`'s
// `.gl-title` rule and `@keyframes gl-title-shimmer` directly.
//
// **Real, confirmed platform split, not a guess**: `@react-native-masked-view/masked-view`'s own
// web implementation (`MaskedView.web.js`) is a complete no-op — `React.createElement(View, props,
// maskElement)` — it discards every child except `maskElement` and does no actual masking at all.
// Verified this by reading the library's own web source after the gradient rendered as solid black
// text in a real screenshot. Native (iOS/Android) gets the real MaskedView+LinearGradient+
// Reanimated-translateX technique (CSS `background-clip:text` has no RN equivalent, MaskedView is
// the standard cross-platform answer — just not on RN Web specifically). Web gets a genuinely
// different implementation: the same gradient/keyframe values applied as raw CSS
// (`backgroundClip`/`WebkitTextFillColor`/`animationName`) directly on the Text's style, which
// react-native-web passes through to the underlying DOM element — this is real, native browser
// CSS doing the same job the original web app's own `.gl-title` rule does, just re-created in RN
// Web's style system instead of a shared stylesheet.
const GRADIENT_CSS = `linear-gradient(90deg,#e0d8c0 0%,#e0d8c0 40%,#b8962e 47%,#c9a84c 49%,#fde97a 50%,#c9a84c 51%,#b8962e 53%,#e0d8c0 60%,#e0d8c0 100%)`

let keyframesInjected = false
function ensureWebKeyframes() {
    if (keyframesInjected || Platform.OS !== 'web' || typeof document === 'undefined') return
    keyframesInjected = true
    const styleEl = document.createElement('style')
    styleEl.textContent = `@keyframes gj-shimmer-sweep { from { background-position: left center; } to { background-position: right center; } }`
    document.head.appendChild(styleEl)
}

const COLORS: [string, string, ...string[]] = [
    '#e0d8c0', '#e0d8c0', '#b8962e', '#c9a84c', '#fde97a', '#c9a84c', '#b8962e', '#e0d8c0', '#e0d8c0',
]
const LOCATIONS: [number, number, ...number[]] = [0, 0.4, 0.47, 0.49, 0.5, 0.51, 0.53, 0.6, 1]

export function ShimmerTitle({ text, style }: { text: string; style?: object }) {
    if (Platform.OS === 'web') {
        ensureWebKeyframes()
        const webStyle = {
            backgroundImage: GRADIENT_CSS,
            backgroundSize: '400% 100%',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
            animationName: 'gj-shimmer-sweep',
            animationDuration: '5s',
            animationTimingFunction: 'linear',
            animationIterationCount: 'infinite',
        }
        return <Text style={[style, webStyle as object]}>{text}</Text>
    }
    return <NativeShimmerTitle text={text} style={style} />
}

function NativeShimmerTitle({ text, style }: { text: string; style?: object }) {
    const [width, setWidth] = useState(0)
    const progress = useSharedValue(0)

    if (width > 0) {
        progress.value = withRepeat(withTiming(1, { duration: 5000, easing: Easing.linear }), -1, false)
    }

    const gradientStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: -progress.value * width * 3 }],
    }))

    return (
        <MaskedView
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            maskElement={<Text style={style}>{text}</Text>}
        >
            <Text style={[style, styles.hiddenText]}>{text}</Text>
            {width > 0 && (
                <Animated.View style={[StyleSheet.absoluteFill, { width: width * 4 }, gradientStyle]}>
                    <LinearGradient
                        colors={COLORS}
                        locations={LOCATIONS}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFill}
                    />
                </Animated.View>
            )}
        </MaskedView>
    )
}

const styles = StyleSheet.create({
    hiddenText: { opacity: 0 },
})
