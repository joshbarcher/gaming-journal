import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useState } from 'react'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { stripHtml } from '@/utils/gameRender'
import type { NewsItem } from 'gaming-journal-contracts/news'

// Port of News.svelte. Web shows a desktop item-list OR a mobile <select> depending on breakpoint
// (≤1279px → dropdown) — since ALL 3 of this app's required breakpoints are ≤1279px, only the
// mobile "select" pattern is ever visible on any required tier, so this builds just that: a
// horizontal pill-row of headlines (the touch equivalent of a native <select>) + a detail panel.
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function News({ items }: { items: NewsItem[] }) {
    const [activeIdx, setActiveIdx] = useState(0)
    if (!items.length) return null
    const active = items[activeIdx]

    return (
        <View style={styles.section}>
            <Text style={styles.title}>News</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
                {items.map((item, i) => (
                    <Pressable
                        key={item.gid ?? i}
                        style={StyleSheet.flatten([styles.pill, i === activeIdx && styles.pillActive])}
                        onPress={() => setActiveIdx(i)}
                    >
                        <Text style={[styles.pillText, i === activeIdx && styles.pillTextActive]} numberOfLines={1}>{item.title}</Text>
                    </Pressable>
                ))}
            </ScrollView>
            <View style={styles.detail}>
                <View style={styles.detailMeta}>
                    <Text style={styles.detailFeed}>{active.feedlabel}</Text>
                    <Text style={styles.detailDate}>{dateFmt.format(new Date(active.date * 1000))}</Text>
                </View>
                <Text style={styles.detailTitle}>{active.title}</Text>
                <Text style={styles.detailBody}>{stripHtml(active.contents)}</Text>
                {active.url && (
                    <Pressable onPress={() => Linking.openURL(active.url!)}>
                        <Text style={styles.detailLink}>Read full article ↗</Text>
                    </Pressable>
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    pillRow: { marginBottom: spacing.sm },
    pill: { maxWidth: 200, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius, backgroundColor: colors.bgHover, marginRight: spacing.xs },
    pillActive: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    pillText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    pillTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    detail: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, gap: spacing.xs },
    detailMeta: { flexDirection: 'row', justifyContent: 'space-between' },
    detailFeed: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11 },
    detailDate: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    detailTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
    detailBody: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 18 },
    detailLink: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12, marginTop: spacing.xs },
})
