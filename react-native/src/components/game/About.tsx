import { StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import { stripHtml } from '@/utils/gameRender'

// Port of About.svelte — renders only if store.detailedDescription is truthy, matching the web
// exactly. Rich HTML rendering deferred to Phase 3's ContentBlockRenderer (see utils/gameRender.ts
// stripHtml note) — shows plain text for now.
export function About({ detailedDescription }: { detailedDescription: string | undefined }) {
    if (!detailedDescription) return null
    return (
        <View style={styles.section}>
            <Text style={styles.title}>About</Text>
            <Text style={styles.body}>{stripHtml(detailedDescription)}</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    body: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20 },
})
