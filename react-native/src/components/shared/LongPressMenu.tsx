import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { type ContextMenuItem, type MenuItem, useLongPressMenuStore } from '@/store/longPressMenuStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

export type { ContextMenuItem, MenuItem }
export { openLongPressMenu } from '@/store/longPressMenuStore'

// Wrap anything that should open a menu on long-press (the touch equivalent of the web app's
// right-click). Long-press duration matches RN's default (~500ms).
export function LongPressTarget({ items, children }: { items: ContextMenuItem[]; children: ReactNode }) {
    const open = useLongPressMenuStore(s => s.open)
    return <Pressable onLongPress={() => open(items)}>{children}</Pressable>
}

// Mount exactly once, near the app root (src/app/_layout.tsx).
export function LongPressMenuHost() {
    const { visible, levels, select, back, close } = useLongPressMenuStore()
    const current = levels[levels.length - 1]

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
            <Pressable style={styles.overlay} onPress={close}>
                <Pressable style={styles.sheet} onPress={() => {}}>
                    {current?.label && (
                        <Pressable style={styles.row} onPress={back}>
                            <Text style={styles.backText}>‹ {current.label}</Text>
                        </Pressable>
                    )}
                    {current?.items === 'loading' && (
                        <View style={styles.row}><Text style={styles.disabledText}>Loading…</Text></View>
                    )}
                    {Array.isArray(current?.items) && current.items.map((item, i) =>
                        item === 'separator' ? (
                            <View key={i} style={styles.separator} />
                        ) : (
                            <Pressable
                                key={i}
                                style={styles.row}
                                disabled={item.disabled}
                                onPress={() => select(item)}
                            >
                                <Text
                                    style={[
                                        styles.rowText,
                                        item.disabled && styles.disabledText,
                                        item.danger && styles.dangerText,
                                    ]}
                                >
                                    {item.label}
                                    {item.external ? '  ↗' : ''}
                                    {item.submenu ? '  ›' : ''}
                                </Text>
                            </Pressable>
                        ),
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    )
}

const styles = StyleSheet.create({
    overlay: {
        flex:            1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent:  'flex-end',
    },
    sheet: {
        backgroundColor: colors.bgRaised,
        borderTopLeftRadius:  radius * 4,
        borderTopRightRadius: radius * 4,
        paddingVertical: spacing.sm,
        paddingBottom:   spacing.xl,
    },
    row: {
        paddingVertical:   spacing.md,
        paddingHorizontal: spacing.lg,
    },
    rowText: {
        color:      colors.text,
        fontFamily: fonts.ui,
        fontSize:   15,
    },
    backText: {
        color:      colors.accent,
        fontFamily: fonts.uiBold,
        fontSize:   14,
    },
    disabledText: {
        color: colors.textMuted,
    },
    dangerText: {
        color: '#e05d5d',
    },
    separator: {
        height:           1,
        backgroundColor:  colors.border,
        marginVertical:   spacing.xs,
        marginHorizontal: spacing.lg,
    },
})
