import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import { NOTE_COLORS, NOTE_TEXT_COLOR } from '@/utils/stickyWall'
import type { StickyNote } from 'gaming-journal-contracts/journalNotes'

// Port of JournalDashboard.svelte's Notes card. The web embeds a real live preview of the first 2
// sticky notes via the StickyWall vendor library (draggable=false, tape=true); this card shows a
// simpler static preview (count + first note's text) instead of a miniature wall.
//
// **Real bug fixed**: this card previously used `notes[0].color` directly as a CSS backgroundColor
// (`notes[0].color || '#e8d77a'`) — but the real `color` field is a PALETTE KEY ('yellow'/'green'/
// 'pink'/'blue'/'purple'/'red'), not a hex value, confirmed by reading the vendor lib's own source
// during the full Notes screen build. RN happens to accept some of those as named colors (so it
// didn't crash), but rendered the wrong, non-matching shade for every color except literally
// "yellow"/"green"/etc.'s CSS-default meaning. Fixed to look the key up in the same NOTE_COLORS
// palette map the full wall now uses.
export function NotesCard({ appid, notes }: { appid: number; notes: StickyNote[] }) {
    return (
        <Pressable style={styles.card} onPress={() => router.push(`/journal/${appid}/notes` as never)}>
            <Text style={styles.title}>Notes</Text>
            {notes.length > 0 ? (
                <View style={styles.preview}>
                    <Text style={styles.count}>{notes.length} note{notes.length !== 1 ? 's' : ''}</Text>
                    <View style={[styles.noteTile, { backgroundColor: NOTE_COLORS[notes[0].color ?? ''] ?? NOTE_COLORS.yellow }]}>
                        <Text style={styles.noteText} numberOfLines={4}>{notes[0].message || notes[0].label}</Text>
                    </View>
                </View>
            ) : (
                <Text style={styles.noData}>No notes yet</Text>
            )}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, gap: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    preview: { gap: spacing.xs },
    count: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    noteTile: { borderRadius: 2, padding: spacing.sm, minHeight: 60 },
    noteText: { color: NOTE_TEXT_COLOR, fontFamily: fonts.ui, fontSize: 12 },
})
