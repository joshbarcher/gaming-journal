import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { useConfirmDialogStore } from '@/store/confirmDialogStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// Mount exactly once, near the app root (src/app/_layout.tsx) — every confirmDialog() call
// anywhere in the app renders through this single instance.
export function ConfirmDialogHost() {
    const { visible, title, body, confirmLabel, close } = useConfirmDialogStore()

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={() => close(false)}>
            <Pressable style={styles.overlay} onPress={() => close(false)}>
                <Pressable style={styles.box} onPress={() => {}}>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.body}>{body}</Text>
                    <View style={styles.actions}>
                        <Pressable style={[styles.button, styles.cancelButton]} onPress={() => close(false)}>
                            <Text style={styles.cancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable style={[styles.button, styles.confirmButton]} onPress={() => close(true)}>
                            <Text style={styles.confirmText}>{confirmLabel}</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    )
}

const styles = StyleSheet.create({
    overlay: {
        flex:            1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        alignItems:      'center',
        justifyContent:  'center',
        padding:         spacing.lg,
    },
    box: {
        backgroundColor: colors.bgRaised,
        borderWidth:      1,
        borderColor:      colors.border,
        borderRadius:     radius,
        padding:          spacing.lg,
        width:            '100%',
        maxWidth:         360,
        gap:              spacing.md,
    },
    title: {
        color:      colors.text,
        fontFamily: fonts.title,
        fontSize:   16,
    },
    body: {
        color:      colors.textMuted,
        fontFamily: fonts.ui,
        fontSize:   14,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap:            spacing.sm,
    },
    button: {
        paddingVertical:   spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius:      radius,
    },
    cancelButton: {
        backgroundColor: colors.bgHover,
    },
    cancelText: {
        color:      colors.text,
        fontFamily: fonts.ui,
    },
    confirmButton: {
        backgroundColor: colors.accent,
    },
    confirmText: {
        color:      colors.bg,
        fontFamily: fonts.uiBold,
    },
})
