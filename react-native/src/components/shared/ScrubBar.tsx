import { useRef } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'

import { colors, fonts, radius } from '@/theme/tokens'

// Port of Counter.svelte's `onTrackMousedown`/`onTrackTouchstart` + MultiCounter.svelte's
// `barDragAction` — both are the exact same click-and-drag-to-scrub track, just at two sizes. RN
// has no separate mouse/touch event pair to port; `PanResponder` (core React Native, no extra
// dependency beyond what's already installed) covers both gesture sources uniformly on every
// platform, which is what the web's own two-listener approach was working around in the first
// place, not a design a real RN app needs to replicate.
//
// **Save timing intentionally split, matching the web exactly**: dragging the bar itself calls the
// caller's `onSettle` **immediately** on release (`onUp`/`onEnd` → `save()`, no debounce) — but the
// separate +/- buttons debounce 400ms (their own `adjust()` has `setTimeout(save, 400)`). This
// component only owns the drag gesture; callers wire the buttons' own debounce separately, since
// that timing difference is real, not an oversight in the port.
export function ScrubBar({ value, target, color, height = 40, onLiveChange, onSettle, children }: {
    value: number
    target: number
    color: string
    height?: number
    // Fires continuously while dragging (live visual feedback, no save) — mirrors the web's
    // `pd.current = ...` assignment inside `onMove`.
    onLiveChange: (next: number) => void
    // Fires once when the drag ends (finger/mouse up) — the web calls `save()` here directly, no
    // debounce, distinct from the +/- buttons' 400ms debounce.
    onSettle: (next: number) => void
    children?: React.ReactNode
}) {
    const widthRef = useRef(0)
    const valueFromX = (x: number) => {
        const w = widthRef.current
        if (!w) return 0
        const p = Math.max(0, Math.min(1, x / w))
        return Math.round(p * target)
    }

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: (e) => onLiveChange(Math.max(0, Math.min(valueFromX(e.nativeEvent.locationX), target))),
            onPanResponderMove: (e) => onLiveChange(Math.max(0, Math.min(valueFromX(e.nativeEvent.locationX), target))),
            onPanResponderRelease: (e) => onSettle(Math.max(0, Math.min(valueFromX(e.nativeEvent.locationX), target))),
            onPanResponderTerminate: (e) => onSettle(Math.max(0, Math.min(valueFromX(e.nativeEvent.locationX), target))),
        }),
    ).current

    const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0

    return (
        <View
            style={[styles.track, { height }]}
            onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width }}
            {...panResponder.panHandlers}
        >
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
            {children}
        </View>
    )
}

const styles = StyleSheet.create({
    track: { position: 'relative', flex: 1, borderRadius: radius, backgroundColor: colors.bgHover, overflow: 'hidden', justifyContent: 'center' },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
})
