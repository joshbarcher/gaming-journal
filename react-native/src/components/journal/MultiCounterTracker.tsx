import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { deletePage, updatePage } from '@/api/journal'
import { ScrubBar } from '@/components/shared/ScrubBar'
import { confirmDialog } from '@/store/confirmDialogStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { percentToColor } from '@/utils/progressHelpers'
import type { CounterEntry, Page } from 'gaming-journal-contracts/pages'

function genId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// Port of MultiCounter.svelte — multiple named counters + a global aggregate bar. **No notes
// field at all** (unlike `progress`/`progress-bars`), confirmed via trackers.md's own callout and
// the real source (no notes-related state/markup anywhere in `MultiCounter.svelte`).
//
// **Row delete goes straight to `confirmDialog` on long-press, not through `LongPressMenu`** — the
// web's own `oncontextmenu` handler calls `confirmDialog` directly with no intermediate menu
// (`showContextMenu` isn't even imported here), since there's only ever one action. Matching that
// exactly is more faithful than wrapping a single action in a drill-down sheet built for 2+ items.
export function MultiCounterTracker({ page, appid }: { page: Page; appid: number }) {
    const [title, setTitle] = useState(page.title ?? '')
    const [counters, setCounters] = useState<CounterEntry[]>(() =>
        (page.counters ?? []).map(c => ({ ...c, id: c.id ?? genId() })),
    )
    const adjustTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const titleMutation = useMutation({ mutationFn: (t: string) => updatePage(page.id, { title: t }) })
    const countersMutation = useMutation({ mutationFn: (next: CounterEntry[]) => updatePage(page.id, { counters: next }) })
    const deleteMutation = useMutation({ mutationFn: () => deletePage(page.id) })

    const totalC = counters.reduce((s, c) => s + (c.current ?? 0), 0)
    const totalT = counters.reduce((s, c) => s + (c.target ?? 0), 0)
    const globalPct = totalT > 0 ? Math.min(100, Math.round((totalC / totalT) * 100)) : 0

    function saveCounters(next: CounterEntry[]) {
        setCounters(next)
        countersMutation.mutate(next)
    }

    function onTitleBlur() {
        const t = title.trim()
        if (!t || t === page.title) { setTitle(page.title ?? ''); return }
        titleMutation.mutate(t)
    }

    function addCounter() {
        saveCounters([...counters, { id: genId(), name: 'New Counter', current: 0, target: 10 }])
    }
    function deleteCounter(id: string) {
        saveCounters(counters.filter(c => c.id !== id))
    }
    function updateName(id: string, text: string) {
        setCounters(cs => cs.map(c => (c.id === id ? { ...c, name: text } : c)))
    }
    function onNameBlur() {
        countersMutation.mutate(counters)
    }
    function onTargetCommit(id: string, text: string) {
        const val = parseInt(text.trim(), 10)
        const c = counters.find(x => x.id === id)
        if (!isNaN(val) && val >= 0) {
            saveCounters(counters.map(x => (x.id === id ? { ...x, target: val } : x)))
        } else {
            saveCounters(counters.map(x => (x.id === id ? { ...x, target: c?.target ?? 0 } : x)))
        }
    }

    // +/- debounces 400ms; drag-release saves immediately — same intentional split as Counter.
    function adjustRow(id: string, delta: number) {
        const next = counters.map(c => (c.id === id ? { ...c, current: Math.max(0, (c.current ?? 0) + delta) } : c))
        setCounters(next)
        if (adjustTimer.current) clearTimeout(adjustTimer.current)
        adjustTimer.current = setTimeout(() => countersMutation.mutate(next), 400)
    }
    function onRowScrubLive(id: string, value: number) {
        setCounters(cs => cs.map(c => (c.id === id ? { ...c, current: value } : c)))
    }
    function onRowScrubSettle(id: string, value: number) {
        const next = counters.map(c => (c.id === id ? { ...c, current: value } : c))
        saveCounters(next)
    }

    async function onRowLongPress(id: string, name: string) {
        const ok = await confirmDialog(`Delete "${name || 'this counter'}"?`, '', 'Delete')
        if (ok) deleteCounter(id)
    }

    async function onDeletePage() {
        const ok = await confirmDialog(`Delete "${page.title}"?`, 'This will permanently delete the multi-counter and all its data.', 'Delete')
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
                <Pressable style={styles.deleteBtn} onPress={onDeletePage}>
                    <Text style={styles.deleteBtnText}>Delete</Text>
                </Pressable>
            </View>

            <View style={styles.header}>
                <TextInput style={styles.titleInput} value={title} onChangeText={setTitle} onBlur={onTitleBlur} />
                <Text style={styles.subtitle}>Multi-Counter</Text>
            </View>

            <View style={styles.globalBar}>
                <View style={[styles.globalFill, { width: `${globalPct}%`, backgroundColor: percentToColor(globalPct) }]} />
                <Text style={styles.globalLabel}>{totalC} / {totalT} · {globalPct}%</Text>
            </View>

            <View style={styles.list}>
                {counters.map(c => (
                    <CounterRow
                        key={c.id}
                        counter={c}
                        onLongPress={() => onRowLongPress(c.id!, c.name ?? '')}
                        onNameChange={(text) => updateName(c.id!, text)}
                        onNameBlur={onNameBlur}
                        onTargetCommit={(text) => onTargetCommit(c.id!, text)}
                        onDec={() => adjustRow(c.id!, -1)}
                        onInc={() => adjustRow(c.id!, 1)}
                        onScrubLive={(v) => onRowScrubLive(c.id!, v)}
                        onScrubSettle={(v) => onRowScrubSettle(c.id!, v)}
                    />
                ))}
            </View>

            <Pressable style={styles.addBtn} onPress={addCounter}>
                <Text style={styles.addBtnText}>+ Add Counter</Text>
            </Pressable>
        </View>
    )
}

function CounterRow({ counter, onLongPress, onNameChange, onNameBlur, onTargetCommit, onDec, onInc, onScrubLive, onScrubSettle }: {
    counter: CounterEntry
    onLongPress: () => void
    onNameChange: (text: string) => void
    onNameBlur: () => void
    onTargetCommit: (text: string) => void
    onDec: () => void
    onInc: () => void
    onScrubLive: (v: number) => void
    onScrubSettle: (v: number) => void
}) {
    const [targetInput, setTargetInput] = useState(String(counter.target ?? ''))
    const current = counter.current ?? 0
    const target = counter.target ?? 0
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0

    return (
        <Pressable style={styles.row} onLongPress={onLongPress} delayLongPress={400}>
            <View style={styles.rowBody}>
                <TextInput style={styles.rowName} value={counter.name ?? ''} onChangeText={onNameChange} onBlur={onNameBlur} />
                <View style={styles.rowVal}>
                    <Text style={styles.rowValText}>{current}</Text>
                    <Text style={styles.rowValSep}> / </Text>
                    <TextInput
                        style={styles.rowTargetInput}
                        value={targetInput}
                        onChangeText={setTargetInput}
                        onBlur={() => onTargetCommit(targetInput)}
                        keyboardType="number-pad"
                    />
                </View>
            </View>
            <View style={styles.rowBarRow}>
                <Pressable style={styles.rowStepBtn} onPress={onDec}><Text style={styles.rowStepBtnText}>−</Text></Pressable>
                <ScrubBar value={current} target={target || 1} color={percentToColor(pct)} height={16} onLiveChange={onScrubLive} onSettle={onScrubSettle} />
                <Pressable style={styles.rowStepBtn} onPress={onInc}><Text style={styles.rowStepBtnText}>+</Text></Pressable>
            </View>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
    // Same real bug/fix as CounterTracker's breadcrumb — see that file's comment.
    breadcrumbWrap: { flex: 1, minWidth: 0 },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 11 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    deleteBtn: { borderWidth: 1, borderColor: '#dc5050', borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: 4 },
    deleteBtnText: { color: '#dc5050', fontFamily: fonts.uiBold, fontSize: 11 },
    header: { paddingHorizontal: spacing.md, gap: 4, marginBottom: spacing.sm },
    titleInput: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    globalBar: { height: 28, marginHorizontal: spacing.md, borderRadius: radius, backgroundColor: colors.bgHover, overflow: 'hidden', justifyContent: 'center', marginBottom: spacing.md, position: 'relative' },
    globalFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
    globalLabel: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12, textAlign: 'center' },
    list: { paddingHorizontal: spacing.md, gap: spacing.sm },
    row: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, gap: spacing.xs },
    rowBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    // Real bug caught by the first screenshot at mobile portrait: a long real counter name (e.g.
    // "I – Magician: Kenji Tomochika") ran straight into the value text with no gap — a single-line
    // TextInput's intrinsic content width can override `flex:1`'s shrink behavior on RN Web unless
    // `minWidth:0` is set explicitly (the standard flexbox fix for "text pushes its flex sibling
    // out," the same underlying class of issue as the earlier `alignItems:'center'` collapse bugs,
    // just the opposite direction — here a child refuses to shrink instead of refusing to grow).
    rowName: { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    rowVal: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
    rowValText: { color: colors.text, fontFamily: fonts.ui, fontSize: 13 },
    rowValSep: { color: colors.textMuted },
    rowTargetInput: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, minWidth: 24, textAlign: 'center' },
    rowBarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    rowStepBtn: { width: 28, height: 28, borderRadius: 4, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    rowStepBtnText: { color: colors.text, fontSize: 14 },
    addBtn: { backgroundColor: colors.bgHover, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.md, alignItems: 'center' },
    addBtnText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
})
