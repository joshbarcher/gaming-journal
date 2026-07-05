import { StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'

// Placeholder for nav destinations not yet built (see react-native/TODO.md phases 1-6).
// Keeps the Drawer shell fully navigable end to end while screens are built out incrementally.
export function ComingSoon({ title }: { title: string }) {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.hint}>Coming soon — see react-native/TODO.md</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex:            1,
        backgroundColor: colors.bg,
        alignItems:      'center',
        justifyContent:  'center',
        gap:             spacing.sm,
    },
    title: {
        color:      colors.text,
        fontFamily: fonts.title,
        fontSize:   18,
    },
    hint: {
        color:      colors.textMuted,
        fontFamily: fonts.ui,
        fontSize:   13,
    },
})
