import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { updatePage } from '@/api/journal'
import { DraggableList } from '@/components/shared/DraggableList'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { triggerCompletionParticles } from '@/utils/particles'
import { globalSegments, segmentColor } from '@/utils/progressHelpers'
import type { Page, Task } from 'gaming-journal-contracts/pages'

const STATES: NonNullable<Task['state']>[] = ['started', 'working', 'done']
const STATE_LABELS: Record<string, string> = { started: 'STARTED', working: 'WORKING', done: 'DONE' }

function genId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// Port of Progress.svelte — the `progress` tracker type (segmented task list). Read the real
// source directly for exact save-timing rules (state/reorder/add/delete are immediate; only notes
// debounce, 800ms, matching trackers.md's own table) and the completion-particle condition (all
// *required*, i.e. non-optional, tasks reaching `done`).
//
// **DraggableList IS the page's own ScrollView** — not wrapped in an outer one. Header (breadcrumb/
// title/segment bar) and footer (Add Task button + notes) pass through the FlatList's own
// ListHeaderComponent/ListFooterComponent, avoiding the "VirtualizedList nested inside a plain
// ScrollView" warning already flagged and avoided elsewhere this session (Hall of Fame item).
//
// **Drag handle is long-press, not the web's mousedown-armed "⠿" handle** — touch has no concept
// of "arm dragging with a mousedown on a specific 6px handle, then drag anywhere"; long-press
// anywhere on the row (matching this app's own `LongPressMenu`/`DraggableList` vocabulary) is the
// natural touch equivalent, so the "⠿" glyph is still shown (visual affordance) but isn't the only
// place a drag can start from — `drag` fires on long-press across the whole row.
//
// **Right-click context menu → LongPressMenu**, same drill-down-sheet primitive used by Guide Pins.
export function ProgressTracker({ page, appid }: { page: Page; appid: number }) {
    const [title, setTitle] = useState(page.title ?? '')
    const [tasks, setTasks] = useState<Task[]>(() =>
        (page.tasks ?? []).map(t => (t.id ? t : { ...t, id: genId(), state: t.state ?? null })),
    )
    const [notes, setNotes] = useState(page.notes ?? '')
    const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const titleMutation = useMutation({ mutationFn: (t: string) => updatePage(page.id, { title: t }) })
    const tasksMutation = useMutation({ mutationFn: (next: Task[]) => updatePage(page.id, { tasks: next }) })
    const notesMutation = useMutation({ mutationFn: (n: string) => updatePage(page.id, { notes: n }) })

    // Port of the web's `_needsIdSave` guard: some real trackers pre-date task ids being required —
    // assign them once and persist immediately so future edits have stable ids to key against.
    const needsIdSaveRef = useRef((page.tasks ?? []).some(t => !t.id))
    useEffect(() => {
        if (needsIdSaveRef.current) {
            needsIdSaveRef.current = false
            tasksMutation.mutate(tasks)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount only, matching the web's one-time onMount check
    }, [])

    function saveTasks(next: Task[]) {
        setTasks(next)
        tasksMutation.mutate(next)
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

    function onStateClick(taskId: string, state: NonNullable<Task['state']>, x: number, y: number) {
        const prevTask = tasks.find(t => t.id === taskId)
        const next = tasks.map(t => (t.id === taskId ? { ...t, state: t.state === state ? null : state } : t))
        const updated = next.find(t => t.id === taskId)
        if (updated?.state === 'done' && prevTask?.state !== 'done') {
            const required = next.filter(t => !t.optional)
            if (required.length > 0 && required.every(t => t.state === 'done')) {
                triggerCompletionParticles(x, y, title)
            }
        }
        saveTasks(next)
    }

    function addTask() {
        saveTasks([...tasks, { id: genId(), title: '', state: null }])
    }
    function deleteTask(id: string) {
        saveTasks(tasks.filter(t => t.id !== id))
    }
    function toggleOptional(id: string) {
        saveTasks(tasks.map(t => (t.id === id ? { ...t, optional: !t.optional } : t)))
    }
    function updateTaskTitle(id: string, text: string) {
        setTasks(ts => ts.map(t => (t.id === id ? { ...t, title: text } : t)))
    }
    function onTaskTitleBlur() {
        tasksMutation.mutate(tasks)
    }

    const segs = globalSegments({ ...page, tasks })

    return (
        <DraggableList
            data={tasks}
            keyExtractor={(t) => t.id!}
            onReorder={saveTasks}
            style={styles.container}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
                <View>
                    <View style={styles.header}>
                        <Pressable onPress={() => router.push(`/journal/${appid}/progress` as never)}>
                            <Text style={styles.breadcrumb}>Home / Journal / Progress Trackers / <Text style={styles.breadcrumbCurrent}>{page.title}</Text></Text>
                        </Pressable>
                        <TextInput style={styles.titleInput} value={title} onChangeText={setTitle} onBlur={onTitleBlur} />
                        <Text style={styles.subtitle}>Progress Tracker</Text>
                    </View>
                    <View style={styles.segBar}>
                        {segs.length === 0 ? (
                            <Text style={styles.segEmptyText}>No tasks yet</Text>
                        ) : (
                            segs.map((s, i) => (
                                <View key={i} style={[styles.seg, s.optional && styles.segOptional, { backgroundColor: s.color }]}>
                                    {!!s.label && <Text style={styles.segLabel} numberOfLines={1}>{s.label}</Text>}
                                    {!!s.stateLabel && <Text style={styles.segState}>{s.stateLabel}</Text>}
                                </View>
                            ))
                        )}
                    </View>
                </View>
            }
            renderItem={({ item, drag, isActive }) => (
                <TaskRow
                    task={item}
                    isActive={isActive}
                    onDrag={drag}
                    onStateClick={(s, x, y) => onStateClick(item.id!, s, x, y)}
                    onTitleChange={(text) => updateTaskTitle(item.id!, text)}
                    onTitleBlur={onTaskTitleBlur}
                    onLongPress={() => openLongPressMenu([
                        { label: item.optional ? 'Unmark Optional' : 'Mark Optional', action: () => toggleOptional(item.id!) },
                        'separator',
                        { label: 'Delete', danger: true, action: () => deleteTask(item.id!) },
                    ])}
                />
            )}
            ListFooterComponent={
                <View>
                    <Pressable style={styles.addBtn} onPress={addTask}>
                        <Text style={styles.addBtnText}>+ Add Task</Text>
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

function TaskRow({ task, isActive, onDrag, onStateClick, onTitleChange, onTitleBlur, onLongPress }: {
    task: Task
    isActive: boolean
    onDrag: () => void
    onStateClick: (state: NonNullable<Task['state']>, x: number, y: number) => void
    onTitleChange: (text: string) => void
    onTitleBlur: () => void
    onLongPress: () => void
}) {
    // Ported from progress.css's real `@media (max-width: 768px)` rule — state buttons wrap onto
    // their own row below the title instead of clipping. 768px isn't one of this app's 3 canonical
    // breakpoints, but falls inside `mobilePortrait` (≤479) at every one of the 3 required test
    // viewports (360/780/1200) with the same visible effect (wraps at 360, doesn't at 780 — 780 is
    // actually *wider* than the web's own 768px cutoff too, so this matches real behavior exactly
    // at all 3 canonical widths, not an approximation).
    const breakpoint = useBreakpoint()
    const wrap = breakpoint === 'mobilePortrait'
    return (
        <Pressable
            style={[styles.taskRow, wrap && styles.taskRowWrap, task.optional && styles.taskRowOptional, isActive && styles.taskRowActive]}
            onLongPress={() => { onLongPress(); }}
            delayLongPress={400}
        >
            <Pressable onLongPress={onDrag} delayLongPress={150} hitSlop={8}>
                <Text style={styles.dragHandle}>⠿</Text>
            </Pressable>
            <TextInput
                style={styles.taskTitleInput}
                value={task.title ?? ''}
                onChangeText={onTitleChange}
                onBlur={onTitleBlur}
                placeholder="Task title"
                placeholderTextColor={colors.textMuted}
            />
            {!!task.optional && <Text style={styles.optionalTag}>OPTIONAL</Text>}
            <View style={[styles.stateBtns, wrap && styles.stateBtnsWrap]}>
                {STATES.map(state => (
                    <Pressable
                        key={state}
                        style={[styles.stateBtn, task.state === state && { backgroundColor: segmentColor(state), borderColor: segmentColor(state) }]}
                        onPress={(e) => onStateClick(state, e.nativeEvent.pageX, e.nativeEvent.pageY)}
                    >
                        <Text style={[styles.stateBtnText, task.state === state && styles.stateBtnTextActive]}>{STATE_LABELS[state]}</Text>
                    </Pressable>
                ))}
            </View>
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
    segLabel: { display: 'none' },
    segState: { display: 'none' },
    taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.xs },
    taskRowWrap: { flexWrap: 'wrap' },
    taskRowOptional: { opacity: 0.7 },
    taskRowActive: { borderColor: colors.borderAct },
    dragHandle: { color: colors.textMuted, fontSize: 16, paddingHorizontal: 4 },
    taskTitleInput: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 14 },
    optionalTag: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 9, backgroundColor: colors.bgHover, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
    stateBtns: { flexDirection: 'row', gap: 4 },
    stateBtnsWrap: { flexBasis: '100%', marginTop: spacing.xs },
    stateBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4 },
    stateBtnText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 9 },
    stateBtnTextActive: { color: '#131210' },
    addBtn: { backgroundColor: colors.bgHover, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.md, alignItems: 'center' },
    addBtnText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    notesWrap: { paddingHorizontal: spacing.md, gap: 4 },
    notesLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase' },
    notesInput: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, minHeight: 80, textAlignVertical: 'top' },
})
