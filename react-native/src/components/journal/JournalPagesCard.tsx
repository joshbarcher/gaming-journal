import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtDate } from '@/utils/journalRender'
import type { Page } from 'gaming-journal-contracts/pages'

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// Port of JournalDashboard.svelte's Journal Pages card (page-type entries, sorted by updatedAt
// descending, first 3 shown as previews).
export function JournalPagesCard({ appid, pages }: { appid: number; pages: Page[] }) {
    const journalPages = pages.filter(p => p.type === 'page')
    const sorted = [...journalPages].sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())

    return (
        <Pressable style={styles.card} onPress={() => router.push(`/journal/${appid}/pages` as never)}>
            <Text style={styles.title}>Journal Pages</Text>
            {sorted.length > 0 ? (
                <View style={styles.list}>
                    {sorted.slice(0, 3).map(p => {
                        const preview = stripHtml(p.content ?? '')
                        return (
                            <View key={p.id} style={styles.pageCard}>
                                <Text style={styles.pageName} numberOfLines={1}>{p.title}</Text>
                                <Text style={styles.pageDate}>Edited {fmtDate(p.updatedAt)}</Text>
                                <Text style={styles.pagePreview} numberOfLines={2}>{preview || 'No content yet'}</Text>
                            </View>
                        )
                    })}
                </View>
            ) : (
                <Text style={styles.noData}>No pages yet</Text>
            )}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, gap: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    list: { gap: spacing.xs },
    pageCard: { backgroundColor: colors.bgHover, borderRadius: 4, padding: spacing.sm, gap: 2 },
    pageName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    pageDate: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    pagePreview: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, lineHeight: 15 },
})
