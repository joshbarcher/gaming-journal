import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { useBreakpoint } from '@/hooks/useBreakpoint'
import { type ContextMenuItem, type MenuItem, useLongPressMenuStore } from '@/store/longPressMenuStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

export type { ContextMenuItem, MenuItem }
export { openLongPressMenu } from '@/store/longPressMenuStore'

const MENU_WIDTH = 280

// Wrap anything that should open a menu on long-press (the touch equivalent of the web app's
// right-click). Passes the touch point so the menu can anchor there as a popover on tablet/desktop.
export function LongPressTarget({ items, children }: { items: ContextMenuItem[]; children: ReactNode }) {
    const open = useLongPressMenuStore(s => s.open)
    return (
        <Pressable onLongPress={(e) => open(items, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}>
            {children}
        </Pressable>
    )
}

// Mount exactly once, near the app root (src/app/_layout.tsx).
export function LongPressMenuHost() {
    const { visible, levels, anchor, select, back, close } = useLongPressMenuStore()
    const breakpoint = useBreakpoint()
    const { width: screenW, height: screenH } = useWindowDimensions()
    const current = levels[levels.length - 1]

    // On a wide screen (tablet-landscape/desktop) the menu is a positioned popover anchored at the
    // long-press point — the web's right-click-at-cursor behaviour. On phone it stays a bottom sheet.
    const isWide = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'

    const body = (
        <>
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
                    <Pressable key={i} style={styles.row} disabled={item.disabled} onPress={() => select(item)}>
                        <Text style={[styles.rowText, item.disabled && styles.disabledText, item.danger && styles.dangerText]}>
                            {item.label}
                            {item.external ? '  ↗' : ''}
                            {item.submenu ? '  ›' : ''}
                        </Text>
                    </Pressable>
                ),
            )}
        </>
    )

    if (isWide) {
        // Anchor the popover at the touch point, clamped to stay on screen; grow downward with a
        // scroll fallback. If there's no anchor (opened programmatically), center it.
        const top = anchor
            ? Math.max(8, Math.min(anchor.y, screenH - 8 - 120))
            : screenH * 0.2
        const left = anchor
            ? Math.max(8, Math.min(anchor.x, screenW - MENU_WIDTH - 8))
            : (screenW - MENU_WIDTH) / 2
        const maxHeight = screenH - top - 8
        return (
            <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
                <Pressable style={styles.popoverOverlay} onPress={close}>
                    <Pressable style={[styles.popover, { top, left, width: MENU_WIDTH, maxHeight }]} onPress={() => {}}>
                        <ScrollView bounces={false}>{body}</ScrollView>
                    </Pressable>
                </Pressable>
            </Modal>
        )
    }

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
            <Pressable style={styles.sheetOverlay} onPress={close}>
                <Pressable style={styles.sheet} onPress={() => {}}>{body}</Pressable>
            </Pressable>
        </Modal>
    )
}

const styles = StyleSheet.create({
    sheetOverlay: {
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
    popoverOverlay: {
        flex:            1,
        backgroundColor: 'rgba(0, 0, 0, 0.25)',
    },
    popover: {
        position:        'absolute',
        backgroundColor: colors.bgRaised,
        borderWidth:     1,
        borderColor:     colors.border,
        borderRadius:    radius * 1.5,
        paddingVertical: spacing.xs,
        // Elevation/shadow so it reads as a floating menu over content.
        elevation:       8,
        shadowColor:     '#000',
        shadowOpacity:   0.4,
        shadowRadius:    12,
        shadowOffset:    { width: 0, height: 4 },
    },
    row: {
        paddingVertical:   spacing.sm,
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
