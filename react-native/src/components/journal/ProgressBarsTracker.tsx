import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native'

import { updatePage } from '@/api/journal'
import { DraggableList } from '@/components/shared/DraggableList'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { triggerCompletionParticles } from '@/utils/particles'
import { globalSegments, segmentColor, stateLabel } from '@/utils/progressHelpers'
import type { Bar, Page, Task } from 'gaming-journal-contracts/pages'

const STATE_CYCLE: (Task['state'] | null)[] = [null, 'started', 'working', 'done']

function genId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// Port of ProgressBars.svelte — the `progress-bars` tracker type (rows of named bars, each holding
// step chips). Read the real source directly for the exact 4-state chip cycle (null→started→
// working→done→null, distinct from the plain `progress` type's 3 direct-set state buttons) and the
// per-bar (not global) particle-completion condition.
//
// **Chip reordering deliberately NOT a drag gesture** — the web has *two independent* HTML5 drag
// systems (bar row drag + a separate per-bar chip drag, with `_dragChipSrc`/`_dragBarSrc` module
// refs preventing them from interfering). Nesting a second, horizontal `DraggableFlatList` inside
// each row of an outer vertical one (the bars list) risks the same "VirtualizedList inside a
// VirtualizedList" fragility already avoided elsewhere this session, for a feature (reordering a
// handful of small chips within one bar) that doesn't need a full gesture system. Long-press a chip
// for "Move Left"/"Move Right" instead — the same up/down-arrow adaptation `PageEditor` already
// uses for its own block reordering, just horizontal. Bars themselves DO use the real
// `DraggableList` drag gesture (one vertical list, no nesting issue).
//
// **Chip title editing deliberately NOT tap-to-edit-inline** — the web distinguishes "tap the chip
// body" (cycle state) from "tap the label specifically" (edit title) via `e.target.closest(...)`,
// which has no clean touch equivalent inside a chip this small. Long-press → "Rename" instead,
// switching that one chip into an editable `TextInput` (local `editingStepId` state) — tap elsewhere
// on the chip still cycles state as the primary action.
export function ProgressBarsTracker({ page, appid }: { page: Page; appid: number }) {
    const [title, setTitle] = useState(page.title ?? '')
    const [bars, setBars] = useState<Bar[]>(() =>
        (page.bars ?? []).map(b => ({
            ...b,
            id: b.id ?? genId(),
            steps: (b.steps ?? []).map(s => ({ ...s, id: s.id ?? genId(), state: s.state ?? null })),
        })),
    )
    const [notes, setNotes] = useState(page.notes ?? '')
    const [editingStepId, setEditingStepId] = useState<string | null>(null)
    const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const breakpoint = useBreakpoint()
    const wrap = breakpoint === 'mobilePortrait'

    const titleMutation = useMutation({ mutationFn: (t: string) => updatePage(page.id, { title: t }) })
    const barsMutation = useMutation({ mutationFn: (next: Bar[]) => updatePage(page.id, { bars: next }) })
    const notesMutation = useMutation({ mutationFn: (n: string) => updatePage(page.id, { notes: n }) })

    function saveBars(next: Bar[]) {
        setBars(next)
        barsMutation.mutate(next)
    }

    function onTitleBlur() {
        const t = title.trim()
        if (!t || t === page.title) { setTitle(page.title ?? ''); return }
        titleMutation.mutate(t)
    }

    function onNotesChange(text: string) {
        setNotes(text)
        if (notesTimer.current) clearTimeout(notesTimer.current)
        notesTimer.current = setTimeout(() => notesMutation.mutate(text), 800)
    }

    function addBar() {
        saveBars([...bars, { id: genId(), title: '', steps: [] }])
    }
    function deleteBar(barId: string) {
        saveBars(bars.filter(b => b.id !== barId))
    }
    function copyBar(barId: string) {
        const src = bars.find(b => b.id === barId)
        if (!src) return
        const copy: Bar = {
            id: genId(), title: src.title, optional: src.optional,
            steps: (src.steps ?? []).map(s => ({ id: genId(), title: s.title, optional: s.optional, state: null })),
        }
        const idx = bars.findIndex(b => b.id === barId)
        saveBars([...bars.slice(0, idx + 1), copy, ...bars.slice(idx + 1)])
    }
    function toggleBarOptional(barId: string) {
        saveBars(bars.map(b => (b.id === barId ? { ...b, optional: !b.optional } : b)))
    }
    function updateBarTitle(barId: string, text: string) {
        setBars(bs => bs.map(b => (b.id === barId ? { ...b, title: text } : b)))
    }
    function onBarTitleBlur() {
        barsMutation.mutate(bars)
    }

    function addStep(barId: string) {
        saveBars(bars.map(b => (b.id === barId ? { ...b, steps: [...(b.steps ?? []), { id: genId(), title: '', state: null }] } : b)))
    }
    function deleteStep(barId: string, stepId: string) {
        saveBars(bars.map(b => (b.id === barId ? { ...b, steps: (b.steps ?? []).filter(s => s.id !== stepId) } : b)))
    }
    function toggleStepOptional(barId: string, stepId: string) {
        saveBars(bars.map(b => (b.id === barId ? { ...b, steps: (b.steps ?? []).map(s => (s.id === stepId ? { ...s, optional: !s.optional } : s)) } : b)))
    }
    function moveStep(barId: string, stepId: string, dir: -1 | 1) {
        const bar = bars.find(b => b.id === barId)
        if (!bar) return
        const steps = [...(bar.steps ?? [])]
        const idx = steps.findIndex(s => s.id === stepId)
        const target = idx + dir
        if (idx === -1 || target < 0 || target >= steps.length) return
        ;[steps[idx], steps[target]] = [steps[target], steps[idx]]
        saveBars(bars.map(b => (b.id === barId ? { ...b, steps } : b)))
    }
    function updateStepTitle(barId: string, stepId: string, text: string) {
        setBars(bs => bs.map(b => (b.id === barId ? { ...b, steps: (b.steps ?? []).map(s => (s.id === stepId ? { ...s, title: text } : s)) } : b)))
    }
    function onStepTitleBlur() {
        setEditingStepId(null)
        barsMutation.mutate(bars)
    }

    function cycleStepState(barId: string, stepId: string, x: number, y: number) {
        const bar = bars.find(b => b.id === barId)
        if (!bar) return
        const step = (bar.steps ?? []).find(s => s.id === stepId)
        if (!step) return
        const prev = step.state
        const idx = STATE_CYCLE.indexOf(step.state ?? null)
        const nextState = STATE_CYCLE[(idx + 1) % STATE_CYCLE.length]
        const nextSteps = (bar.steps ?? []).map(s => (s.id === stepId ? { ...s, state: nextState } : s))
        if (nextState === 'done' && prev !== 'done') {
            const required = nextSteps.filter(s => !s.optional)
            if (required.length > 0 && required.every(s => s.state === 'done')) {
                triggerCompletionParticles(x, y, bar.title ?? '')
            }
        }
        saveBars(bars.map(b => (b.id === barId ? { ...b, steps: nextSteps } : b)))
    }

    function openBarMenu(barId: string) {
        const bar = bars.find(b => b.id === barId)
        openLongPressMenu([
            { label: bar?.optional ? 'Unmark Optional' : 'Mark Optional', action: () => toggleBarOptional(barId) },
            'separator',
            { label: 'Duplicate', action: () => copyBar(barId) },
            { label: 'Delete', danger: true, action: () => deleteBar(barId) },
        ])
    }

    function openStepMenu(barId: string, stepId: string) {
        const bar = bars.find(b => b.id === barId)
        const step = bar?.steps?.find(s => s.id === stepId)
        openLongPressMenu([
            { label: 'Rename', action: () => setEditingStepId(stepId) },
            { label: step?.optional ? 'Unmark Optional' : 'Mark Optional', action: () => toggleStepOptional(barId, stepId) },
            { label: 'Move Left', action: () => moveStep(barId, stepId, -1) },
            { label: 'Move Right', action: () => moveStep(barId, stepId, 1) },
            'separator',
            { label: 'Delete', danger: true, action: () => deleteStep(barId, stepId) },
        ])
    }

    const segs = globalSegments({ ...page, bars })

    return (
        <DraggableList
            data={bars}
            keyExtractor={(b) => b.id!}
            onReorder={saveBars}
            style={styles.container}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
                <View>
                    <View style={styles.header}>
                        <Pressable onPress={() => router.push(`/journal/${appid}/progress` as never)}>
                            <Text style={styles.breadcrumb}>Home / Journal / Progress Trackers / <Text style={styles.breadcrumbCurrent}>{page.title}</Text></Text>
                        </Pressable>
                        <TextInput style={styles.titleInput} value={title} onChangeText={setTitle} onBlur={onTitleBlur} />
                        <Text style={styles.subtitle}>Multi-Bar Progress Tracker</Text>
                    </View>
                    <View style={styles.segBar}>
                        {segs.length === 0 ? (
                            <Text style={styles.segEmptyText}>No bars yet</Text>
                        ) : (
                            segs.map((s, i) => (
                                <View key={i} style={[styles.seg, s.optional && styles.segOptional, { backgroundColor: s.color }]}>
                                    <Text style={styles.segNum}>{s.num}</Text>
                                    {!!s.stateLabel && <Text style={styles.segState}>{s.stateLabel}</Text>}
                                </View>
                            ))
                        )}
                    </View>
                </View>
            }
            renderItem={({ item: bar, drag, isActive }) => (
                <BarRow
                    bar={bar}
                    isActive={isActive}
                    wrap={wrap}
                    onDrag={drag}
                    onLongPress={() => openBarMenu(bar.id!)}
                    onTitleChange={(text) => updateBarTitle(bar.id!, text)}
                    onTitleBlur={onBarTitleBlur}
                    onAddStep={() => addStep(bar.id!)}
                    editingStepId={editingStepId}
                    onStepPress={(stepId, x, y) => cycleStepState(bar.id!, stepId, x, y)}
                    onStepLongPress={(stepId) => openStepMenu(bar.id!, stepId)}
                    onStepTitleChange={(stepId, text) => updateStepTitle(bar.id!, stepId, text)}
                    onStepTitleBlur={onStepTitleBlur}
                />
            )}
            ListFooterComponent={
                <View>
                    <Pressable style={styles.addBtn} onPress={addBar}>
                        <Text style={styles.addBtnText}>+ Add Bar</Text>
                    </Pressable>
                    <View style={styles.notesWrap}>
                        <Text style={styles.notesLabel}>Notes</Text>
                        <TextInput
                            style={styles.notesInput}
                            value={notes}
                            onChangeText={onNotesChange}
                            placeholder="Add notes…"
                            placeholderTextColor={colors.textMuted}
                            multiline
                        />
                    </View>
                </View>
            }
        />
    )
}

function BarRow({ bar, isActive, wrap, onDrag, onLongPress, onTitleChange, onTitleBlur, onAddStep, editingStepId, onStepPress, onStepLongPress, onStepTitleChange, onStepTitleBlur }: {
    bar: Bar
    isActive: boolean
    wrap: boolean
    onDrag: () => void
    onLongPress: () => void
    onTitleChange: (text: string) => void
    onTitleBlur: () => void
    onAddStep: () => void
    editingStepId: string | null
    onStepPress: (stepId: string, x: number, y: number) => void
    onStepLongPress: (stepId: string) => void
    onStepTitleChange: (stepId: string, text: string) => void
    onStepTitleBlur: () => void
}) {
    return (
        <Pressable
            style={[styles.barRow, wrap && styles.barRowWrap, bar.optional && styles.barRowOptional, isActive && styles.barRowActive]}
            onLongPress={onLongPress}
            delayLongPress={400}
        >
            <Pressable onLongPress={onDrag} delayLongPress={150} hitSlop={8}>
                <Text style={styles.dragHandle}>⠿</Text>
            </Pressable>
            <TextInput
                style={[styles.barTitleInput, wrap && styles.barTitleInputWrap]}
                value={bar.title ?? ''}
                onChangeText={onTitleChange}
                onBlur={onTitleBlur}
                multiline
                placeholder="Bar title"
                placeholderTextColor={colors.textMuted}
            />
            {!!bar.optional && <Text style={styles.optionalTag}>OPTIONAL</Text>}
            <View style={[styles.chipsRow, wrap && styles.chipsRowWrap]}>
                {(bar.steps ?? []).map(step => (
                    <Chip
                        key={step.id}
                        step={step}
                        editing={editingStepId === step.id}
                        onPress={(e) => onStepPress(step.id!, e.nativeEvent.pageX, e.nativeEvent.pageY)}
                        onLongPress={() => onStepLongPress(step.id!)}
                        onTitleChange={(text) => onStepTitleChange(step.id!, text)}
                        onTitleBlur={onStepTitleBlur}
                    />
                ))}
                <Pressable style={styles.chipAdd} onPress={onAddStep}>
                    <Text style={styles.chipAddText}>+</Text>
                </Pressable>
            </View>
        </Pressable>
    )
}

function Chip({ step, editing, onPress, onLongPress, onTitleChange, onTitleBlur }: {
    step: Task
    editing: boolean
    onPress: (e: GestureResponderEvent) => void
    onLongPress: () => void
    onTitleChange: (text: string) => void
    onTitleBlur: () => void
}) {
    const bg = step.state ? segmentColor(step.state) : 'rgba(255,255,255,0.07)'
    return (
        <Pressable
            style={[styles.chip, { backgroundColor: bg }, step.optional && styles.chipOptional]}
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={400}
        >
            {editing ? (
                <TextInput
                    style={styles.chipLabelInput}
                    value={step.title ?? ''}
                    onChangeText={onTitleChange}
                    onBlur={onTitleBlur}
                    autoFocus
                />
            ) : (
                <Text style={styles.chipLabel} numberOfLines={2}>{step.title || 'Step'}</Text>
            )}
            {!!stateLabel(step.state) && <Text style={styles.chipState}>{stateLabel(step.state)}</Text>}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    listContent: { paddingBottom: spacing.xl },
    header: { padding: spacing.md, gap: 4 },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 11 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    titleInput: { color: colors.text, fontFamily: fonts.title, fontSize: 22, paddingVertical: 4 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    segBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, paddingHorizontal: spacing.md, marginBottom: spacing.md },
    segEmptyText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    seg: { minWidth: 28, height: 28, borderRadius: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    segOptional: { opacity: 0.5 },
    segNum: { color: '#131210', fontFamily: fonts.uiBold, fontSize: 10 },
    segState: { display: 'none' },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.xs },
    barRowWrap: { flexWrap: 'wrap', alignItems: 'flex-start' },
    barRowOptional: { opacity: 0.7 },
    barRowActive: { borderColor: colors.borderAct },
    dragHandle: { color: colors.textMuted, fontSize: 16, paddingHorizontal: 4 },
    barTitleInput: { width: 110, color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    barTitleInputWrap: { flex: 1, width: 'auto' },
    optionalTag: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 9, backgroundColor: colors.bgHover, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
    chipsRow: { flex: 1, flexDirection: 'row', gap: 5 },
    chipsRowWrap: { flexBasis: '100%', marginTop: spacing.xs },
    chip: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
    chipOptional: { opacity: 0.6 },
    chipLabel: { color: '#131210', fontFamily: fonts.uiBold, fontSize: 10, textAlign: 'center' },
    chipLabelInput: { color: '#131210', fontFamily: fonts.uiBold, fontSize: 10, textAlign: 'center', minWidth: 40 },
    chipState: { color: 'rgba(0,0,0,0.65)', fontFamily: fonts.uiBold, fontSize: 8, textTransform: 'uppercase', marginTop: 2 },
    chipAdd: { width: 30, height: 44, borderRadius: 4, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
    chipAddText: { color: colors.textMuted, fontSize: 16 },
    addBtn: { backgroundColor: colors.bgHover, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.md, alignItems: 'center' },
    addBtnText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    notesWrap: { paddingHorizontal: spacing.md, gap: 4 },
    notesLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase' },
    notesInput: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, minHeight: 80, textAlignVertical: 'top' },
})
