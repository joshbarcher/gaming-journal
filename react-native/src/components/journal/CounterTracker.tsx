import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { deletePage, updatePage } from '@/api/journal'
import { ScrubBar } from '@/components/shared/ScrubBar'
import { confirmDialog } from '@/store/confirmDialogStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { percentToColor } from '@/utils/progressHelpers'
import type { Page } from 'gaming-journal-contracts/pages'

// Port of Counter.svelte — single numeric counter with a target. Read the real source directly:
// it already implements a real touch scrub gesture (`ontouchstart`/`ontouchmove`/`ontouchend`,
// alongside its own mouse listeners) — this is the type the TODO checklist's own "scrub-bar via
// PanGestureHandler" phrase actually describes, not the progress-bars item (see that item's own
// writeup — its real interaction is a 4-state tap-cycle, no scrub gesture exists there at all).
// Uses `PanResponder` (core RN) rather than `react-native-gesture-handler`'s Pan gesture — no new
// dependency needed, and PanResponder already uniformly covers what the web needed two separate
// mouse/touch listener pairs for.
export function CounterTracker({ page, appid }: { page: Page; appid: number }) {
    const [title, setTitle] = useState(page.title ?? '')
    const [description, setDescription] = useState(page.description ?? '')
    const [current, setCurrent] = useState(page.current ?? 0)
    const [target, setTarget] = useState(page.target ?? 0)
    const [targetInput, setTargetInput] = useState(String(page.target ?? ''))
    const adjustTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const titleMutation = useMutation({ mutationFn: (t: string) => updatePage(page.id, { title: t }) })
    const descMutation = useMutation({ mutationFn: (d: string) => updatePage(page.id, { description: d }) })
    const valueMutation = useMutation({ mutationFn: (v: { current: number; target: number }) => updatePage(page.id, v) })
    const deleteMutation = useMutation({ mutationFn: () => deletePage(page.id) })

    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
    const color = percentToColor(pct)

    function onTitleBlur() {
        const t = title.trim()
        if (!t) { setTitle(page.title ?? ''); return }
        if (t === page.title) return
        titleMutation.mutate(t)
    }

    function onDescBlur() {
        const d = description.trim()
        if (d === (page.description ?? '')) return
        descMutation.mutate(d)
    }

    function onTargetBlur() {
        const val = parseInt(targetInput.trim(), 10)
        if (!isNaN(val) && val > 0) {
            setTarget(val)
            valueMutation.mutate({ current, target: val })
        } else {
            setTargetInput(String(target || ''))
        }
    }

    // +/- buttons debounce 400ms (matching `adjust()`); drag-release saves immediately (below) —
    // a real, intentional timing difference ported from the web, not a simplification.
    function adjust(delta: number) {
        const next = Math.max(0, current + delta)
        setCurrent(next)
        if (adjustTimer.current) clearTimeout(adjustTimer.current)
        adjustTimer.current = setTimeout(() => valueMutation.mutate({ current: next, target }), 400)
    }

    function onScrubSettle(next: number) {
        setCurrent(next)
        valueMutation.mutate({ current: next, target })
    }

    async function onDelete() {
        const ok = await confirmDialog(`Delete "${page.title}"?`, 'This will permanently delete the counter and all its data.', 'Delete')
        if (!ok) return
        await deleteMutation.mutateAsync()
        router.replace(`/journal/${appid}` as never)
    }

    return (
        <View style={styles.container}>
            <View style={styles.subHeader}>
                <Pressable style={styles.breadcrumbWrap} onPress={() => router.push(`/journal/${appid}/progress` as never)}>
                    <Text style={styles.breadcrumb} numberOfLines={1}>Home / Journal / Progress Trackers / <Text style={styles.breadcrumbCurrent}>{page.title}</Text></Text>
                </Pressable>
                <Pressable style={styles.deleteBtn} onPress={onDelete}>
                    <Text style={styles.deleteBtnText}>Delete</Text>
                </Pressable>
            </View>

            <View style={styles.body}>
                <TextInput style={styles.bigTitle} value={title} onChangeText={setTitle} onBlur={onTitleBlur} multiline />
                <TextInput
                    style={styles.desc}
                    value={description}
                    onChangeText={setDescription}
                    onBlur={onDescBlur}
                    placeholder="Add a description…"
                    placeholderTextColor={colors.textMuted}
                />

                <View style={styles.barOuter}>
                    <Pressable style={styles.stepBtn} onPress={() => adjust(-1)}>
                        <Text style={styles.stepBtnText}>−</Text>
                    </Pressable>
                    <ScrubBar value={current} target={target || 1} color={color} height={56} onLiveChange={setCurrent} onSettle={onScrubSettle}>
                        <View style={styles.overlayLeft}>
                            <Text style={styles.overlayVal}>
                                {current}
                                <Text style={styles.overlaySep}> / </Text>
                            </Text>
                            <TextInput
                                style={styles.targetInput}
                                value={targetInput}
                                onChangeText={setTargetInput}
                                onBlur={onTargetBlur}
                                keyboardType="number-pad"
                            />
                        </View>
                        <Text style={styles.overlayPct}>{pct}%</Text>
                    </ScrubBar>
                    <Pressable style={styles.stepBtn} onPress={() => adjust(1)}>
                        <Text style={styles.stepBtnText}>+</Text>
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
    // Real bug, same class as MultiCounter's row-name overflow: `flex:1` on the *Text* did nothing
    // useful because its parent `Pressable` (a View) wasn't itself a constrained flex item — it
    // sized to the Text's full intrinsic content width regardless, pushing the sibling Delete
    // button (and the whole row) past the viewport at mobile portrait. Fixed by making the
    // `Pressable` itself the flexible, shrinkable item (`flex:1, minWidth:0`) and truncating the
    // Text with `numberOfLines={1}` — a real ellipsis is preferable to silent overflow here, since
    // unlike the row-name/value case there's no natural second visual anchor to just add a gap
    // before.
    breadcrumbWrap: { flex: 1, minWidth: 0 },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 11 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    deleteBtn: { borderWidth: 1, borderColor: '#dc5050', borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: 4 },
    deleteBtnText: { color: '#dc5050', fontFamily: fonts.uiBold, fontSize: 11 },
    body: { padding: spacing.lg, alignItems: 'center' },
    bigTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 26, textAlign: 'center', marginBottom: spacing.xs, width: '100%' },
    desc: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 14, textAlign: 'center', marginBottom: spacing.lg, width: '100%' },
    barOuter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, width: '100%', maxWidth: 480 },
    stepBtn: { width: 44, height: 44, borderRadius: radius, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    stepBtnText: { color: colors.text, fontSize: 20, fontFamily: fonts.uiBold },
    // **Real bug caught by the first screenshot**: originally used dark (`#131210`) overlay text,
    // assuming it needed to read against the light-colored fill — but Persona Compendium's real
    // 14% fill left most of the track showing the dark unfilled background, where dark-on-dark
    // text was nearly invisible. Checked `game-journal.css`'s real `.counter-overlay-val` rule
    // directly: the web uses near-white text (`rgba(255,255,255,0.9)`) with a drop shadow
    // (`text-shadow: 0 1px 4px rgba(0,0,0,0.5)`) specifically so it stays legible against *both*
    // the dark track and the colored fill — not dark text as assumed. `textShadow*` is RN's real
    // (if soon-to-be-renamed-to-`textShadow`-object) style API equivalent.
    overlayLeft: { position: 'absolute', left: spacing.md, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' },
    overlayVal: { color: 'rgba(255,255,255,0.9)', fontFamily: fonts.uiBold, fontSize: 16, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
    overlaySep: { color: 'rgba(255,255,255,0.35)', fontWeight: '300' },
    targetInput: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.uiBold, fontSize: 16, minWidth: 30, textAlign: 'center' },
    overlayPct: { position: 'absolute', right: spacing.md, color: 'rgba(255,255,255,0.45)', fontFamily: fonts.uiBold, fontSize: 11 },
})
