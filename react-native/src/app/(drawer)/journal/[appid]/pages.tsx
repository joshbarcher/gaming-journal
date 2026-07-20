import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { getGameDetail } from '@/api/gamePage'
import { createPage, deletePage, getJournalPages } from '@/api/journal'
import { Lucide } from '@/components/shared/Lucide'
import { confirmDialog } from '@/store/confirmDialogStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { fmtDate } from '@/utils/journalRender'
import type { Page } from 'gaming-journal-contracts/pages'

// Port of JournalPages.svelte — the page/notes-type list at /journal/{appid}/pages. "+ New Page"
// creates a real `type: 'page'` record and navigates straight into its editor, matching the web
// exactly (no name-prompt dialog — the page starts titled "New Page" and is renamed inline).
export default function JournalPagesScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const queryClient = useQueryClient()

    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const pagesQuery = useQuery({ queryKey: ['journalPages', appid], queryFn: () => getJournalPages(appid) })

    const createMutation = useMutation({
        mutationFn: () => createPage({ type: 'page', title: 'New Page', appid: String(appid) }),
        onSuccess: (page) => {
            queryClient.invalidateQueries({ queryKey: ['journalPages', appid] })
            router.push(`/${page.id}` as never)
        },
    })
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deletePage(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['journalPages', appid] }),
    })

    async function onDelete(p: Page) {
        const ok = await confirmDialog(`Delete "${p.title}"?`, 'This will permanently delete the page and all its content.', 'Delete')
        if (!ok) return
        deleteMutation.mutate(p.id)
    }

    const pages = (pagesQuery.data ?? []).filter(p => p.type === 'page' || p.type === 'notes')

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Pressable onPress={() => router.push(`/journal/${appid}` as never)}>
                    <Text style={styles.breadcrumb}>
                        Home / {gameQuery.data?.name ?? '…'} / Journal / <Text style={styles.breadcrumbCurrent}>Pages</Text>
                    </Text>
                </Pressable>
                <Pressable style={styles.newBtn} onPress={() => createMutation.mutate()} disabled={createMutation.isPending}>
                    <Text style={styles.newBtnText}>{createMutation.isPending ? 'Creating…' : '+ New Page'}</Text>
                </Pressable>
            </View>

            <View style={styles.list}>
                {pages.length === 0 ? (
                    <Text style={styles.noData}>No pages yet. Create one to start writing.</Text>
                ) : (
                    pages.map(p => (
                        <Pressable key={p.id} style={styles.item} onPress={() => router.push(`/${p.id}` as never)}>
                            <Lucide name={p.type === 'notes' ? 'notebook-pen' : 'file-text'} color={colors.accent} size={20} />
                            <View style={styles.itemBody}>
                                <Text style={styles.itemTitle}>{p.title}</Text>
                                <Text style={styles.itemMeta}>{p.type === 'notes' ? 'Notes page' : 'Rich page'} · Updated {fmtDate(p.updatedAt)}</Text>
                            </View>
                            <Pressable onPress={() => onDelete(p)} hitSlop={8}>
                                <Text style={styles.itemDelete}>×</Text>
                            </Pressable>
                        </Pressable>
                    ))
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 12 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    newBtn: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    newBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, padding: spacing.md },
    list: { paddingHorizontal: spacing.md, gap: spacing.xs },
    item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm },
    itemIcon: { fontSize: 20 },
    itemBody: { flex: 1, gap: 2 },
    itemTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
    itemMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    itemDelete: { color: colors.textMuted, fontSize: 20, paddingHorizontal: spacing.xs },
})
