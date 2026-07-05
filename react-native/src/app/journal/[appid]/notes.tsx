import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { getGameDetail } from '@/api/gamePage'
import { getJournalNotes, setJournalNotes } from '@/api/journal'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { confirmDialog } from '@/store/confirmDialogStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { genNoteId, NOTE_COLORS, NOTE_FROM_COLOR, NOTE_SIZE_WIDTH, NOTE_TEXT_COLOR, pickColor, pickRotation } from '@/utils/stickyWall'
import type { StickyNote } from 'gaming-journal-contracts/journalNotes'

// Port of JournalNotes.svelte + the StickyWall vendor lib (src/lib/js/vendor/stickywall.js) —
// journal/notes.md's "Sticky Notes" section. PLAN.md called this "the highest-risk single
// feature, no RN equivalent exists," assuming a freeform x/y-position drag corkboard. Reading the
// real vendor source (not just the doc) shows that's wrong: there is NO position field on a note
// at all. It's a `flex-wrap` grid of note cards with a small COSMETIC per-index rotation
// (`ROTATIONS[idx % ROTATIONS.length]`, not user-adjustable) and 3 fixed widths (sm/md/lg, always
// 'md' for anything added through the real UI — the add/edit form has no size or color picker
// anywhere; both are auto-assigned by array position via `#normalize()`/`#pickColor()`).
// "Draggable" in the real lib means HTML5 drag-and-drop LIST REORDERING (insert before/after a
// target note), not a free 2D transform — this is the exact same shape of problem already solved
// for `ProgressBarsTracker.tsx`'s chip reordering: a variable-width wrap-grid has no good
// off-the-shelf RN drag primitive (react-native-draggable-flatlist assumes uniform-size list/grid
// cells), so reordering here is a long-press → "Move Left"/"Move Right" action instead of true
// drag, same precedented simplification as that chip reorder.
//
// Every add/update/remove/reorder saves the FULL notes array immediately (matching
// `JournalNotes.svelte`'s `_save()` on every `sw:*` event) — no separate "Save" step.
export default function JournalNotesScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const queryClient = useQueryClient()

    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const notesQuery = useQuery({ queryKey: ['journalNotes', appid], queryFn: () => getJournalNotes(appid) })

    const saveMutation = useMutation({
        mutationFn: (notes: StickyNote[]) => setJournalNotes(appid, notes),
        onSuccess: (saved) => queryClient.setQueryData(['journalNotes', appid], saved),
    })

    const notes = notesQuery.data ?? []

    const [showModal, setShowModal] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [formLabel, setFormLabel] = useState('')
    const [formMessage, setFormMessage] = useState('')
    const [formFrom, setFormFrom] = useState('')

    function openAdd() {
        setEditingId(null); setFormLabel(''); setFormMessage(''); setFormFrom('')
        setShowModal(true)
    }

    function openEdit(note: StickyNote) {
        setEditingId(note.id); setFormLabel(note.label ?? ''); setFormMessage(note.message ?? ''); setFormFrom(note.from ?? '')
        setShowModal(true)
    }

    function submitForm() {
        const message = formMessage.trim()
        if (!message) return
        const label = formLabel.trim()
        const from = formFrom.trim()

        if (editingId !== null) {
            const next = notes.map(n => n.id === editingId ? { ...n, label, message, from } : n)
            saveMutation.mutate(next)
        } else {
            const idx = notes.length
            const newNote: StickyNote = {
                id: genNoteId(), label, message, from,
                size: 'md', color: pickColor(idx), rotation: pickRotation(idx),
            }
            saveMutation.mutate([...notes, newNote])
        }
        setShowModal(false)
    }

    async function onRemove(note: StickyNote) {
        const ok = await confirmDialog('Remove this note?', note.message || note.label || 'This note will be permanently removed.', 'Remove')
        if (!ok) return
        saveMutation.mutate(notes.filter(n => n.id !== note.id))
    }

    function moveNote(id: string, dir: -1 | 1) {
        const idx = notes.findIndex(n => n.id === id)
        const target = idx + dir
        if (idx === -1 || target < 0 || target >= notes.length) return
        const next = [...notes]
        const [n] = next.splice(idx, 1)
        next.splice(target, 0, n)
        saveMutation.mutate(next)
    }

    function openNoteMenu(note: StickyNote) {
        const idx = notes.findIndex(n => n.id === note.id)
        openLongPressMenu([
            { label: '‹ Move earlier', action: () => moveNote(note.id, -1), disabled: idx <= 0 },
            { label: 'Move later ›', action: () => moveNote(note.id, 1), disabled: idx >= notes.length - 1 },
        ])
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Pressable onPress={() => router.push(`/journal/${appid}` as never)}>
                    <Text style={styles.breadcrumb}>
                        Home / {gameQuery.data?.name ?? '…'} / Journal / <Text style={styles.breadcrumbCurrent}>Notes</Text>
                    </Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={openAdd}>
                    <Text style={styles.addBtnText}>+ Add Note</Text>
                    {notes.length > 0 && (
                        <View style={styles.countBadge}><Text style={styles.countBadgeText}>{notes.length}</Text></View>
                    )}
                </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.wall}>
                {notes.length === 0 ? (
                    <Text style={styles.empty}>No notes yet.</Text>
                ) : (
                    notes.map(note => (
                        <NoteCard key={note.id} note={note} onEdit={() => openEdit(note)} onRemove={() => onRemove(note)} onLongPress={() => openNoteMenu(note)} />
                    ))
                )}
            </ScrollView>

            {showModal && (
                <View style={styles.modalBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowModal(false)} />
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>{editingId !== null ? 'Edit note' : 'Add a note'}</Text>
                            <Pressable onPress={() => setShowModal(false)}><Text style={styles.modalClose}>×</Text></Pressable>
                        </View>
                        <TextInput
                            style={styles.input}
                            placeholder="Label (optional)"
                            placeholderTextColor={colors.textMuted}
                            value={formLabel}
                            onChangeText={setFormLabel}
                        />
                        <TextInput
                            style={[styles.input, styles.inputMulti]}
                            placeholder="Your message…"
                            placeholderTextColor={colors.textMuted}
                            multiline
                            value={formMessage}
                            onChangeText={setFormMessage}
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="From (name)"
                            placeholderTextColor={colors.textMuted}
                            value={formFrom}
                            onChangeText={setFormFrom}
                        />
                        <View style={styles.modalActions}>
                            <Pressable style={[styles.submitBtn, !formMessage.trim() && styles.submitBtnDisabled]} disabled={!formMessage.trim()} onPress={submitForm}>
                                <Text style={styles.submitBtnText}>{editingId !== null ? 'Save' : 'Add'}</Text>
                            </Pressable>
                            <Pressable style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                                <Text style={styles.cancelBtnText}>Cancel</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            )}
        </View>
    )
}

function NoteCard({ note, onEdit, onRemove, onLongPress }: { note: StickyNote; onEdit: () => void; onRemove: () => void; onLongPress: () => void }) {
    const width = NOTE_SIZE_WIDTH[note.size ?? 'md'] ?? NOTE_SIZE_WIDTH.md
    const bg = NOTE_COLORS[note.color ?? ''] ?? NOTE_COLORS.yellow
    return (
        <Pressable
            style={[styles.note, { width, backgroundColor: bg, transform: [{ rotate: `${note.rotation ?? 0}deg` }] }]}
            onLongPress={onLongPress}
        >
            <View style={styles.tape} />
            <View style={styles.noteActions}>
                <Pressable onPress={onEdit} hitSlop={6}><Text style={styles.noteActionIcon}>✎</Text></Pressable>
                <Pressable onPress={onRemove} hitSlop={6}><Text style={styles.noteActionIcon}>×</Text></Pressable>
            </View>
            {!!note.label && <Text style={styles.noteLabel}>{note.label}</Text>}
            <Text style={styles.noteMsg}>{note.message}</Text>
            {!!note.from && <Text style={styles.noteFrom}>— {note.from}</Text>}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 12 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    addBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    countBadge: { backgroundColor: 'rgba(201,168,76,0.2)', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
    countBadgeText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 10 },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, fontStyle: 'italic', padding: spacing.xl, textAlign: 'center', width: '100%' },
    wall: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, padding: spacing.md, paddingTop: spacing.lg + 6 },
    note: {
        borderRadius: 2, padding: 14, paddingTop: 16, gap: 8,
        shadowColor: '#000', shadowOffset: { width: 3, height: 5 }, shadowOpacity: 0.55, shadowRadius: 12,
    },
    tape: {
        position: 'absolute', top: -10, left: '50%', marginLeft: -22,
        width: 44, height: 18, borderRadius: 2, transform: [{ rotate: '-1deg' }],
        backgroundColor: 'rgba(200,190,150,0.18)', borderWidth: 1, borderColor: 'rgba(200,190,150,0.12)',
    },
    noteActions: { position: 'absolute', top: 4, right: 6, flexDirection: 'row', gap: 10 },
    noteActionIcon: { color: NOTE_FROM_COLOR, fontSize: 15 },
    noteLabel: { color: NOTE_FROM_COLOR, fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginRight: 34 },
    noteMsg: { color: NOTE_TEXT_COLOR, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20 },
    noteFrom: { color: NOTE_FROM_COLOR, fontFamily: fonts.uiBold, fontSize: 11, textAlign: 'right' },
    modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
    modalCard: { width: '100%', maxWidth: 380, backgroundColor: colors.bgRaised, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    modalTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
    modalClose: { color: colors.textMuted, fontSize: 18 },
    input: { backgroundColor: colors.bgHover, borderWidth: 1, borderColor: colors.border, borderRadius: radius, color: colors.text, fontFamily: fonts.ui, fontSize: 13, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
    inputMulti: { minHeight: 72, textAlignVertical: 'top' },
    modalActions: { flexDirection: 'row', gap: spacing.sm },
    submitBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius, backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    submitBtnDisabled: { opacity: 0.4 },
    submitBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    cancelBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius, borderWidth: 1, borderColor: colors.border },
    cancelBtnText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
})
