import { useParticlesStore } from '@/store/particlesStore'

// Port of fireParticles() (src/lib/js/particles.ts) — the web fires from a clicked DOM element's
// `getBoundingClientRect()` center; RN has no DOM node to measure at the call site, so callers pass
// the press position directly (`GestureResponderEvent.nativeEvent.pageX/pageY`, available on every
// `Pressable.onPress`) instead of a source-element reference. Same effect, different addressing —
// same category of adaptation as Guide Pins' block-index-instead-of-DOM-path pins.
export function triggerCompletionParticles(x: number, y: number, label: string): void {
    useParticlesStore.getState().fire(x, y, label)
}
