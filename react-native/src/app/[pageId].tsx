import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getPage } from '@/api/journal'
import { CounterTracker } from '@/components/journal/CounterTracker'
import { MultiCounterTracker } from '@/components/journal/MultiCounterTracker'
import { PageEditor } from '@/components/journal/PageEditor'
import { ProgressBarsTracker } from '@/components/journal/ProgressBarsTracker'
import { ProgressTracker } from '@/components/journal/ProgressTracker'
import { colors, fonts, spacing } from '@/theme/tokens'

// Port of src/routes/[pageId]/+page.svelte — a polymorphic dispatcher keyed by the page's own
// `type` field, matching the web's PAGE_COMPONENTS lookup table exactly (list/progress/
// progress-bars/notes/page/counter/multi-counter). Every tracker type (`progress`/`progress-bars`/
// `counter`/`multi-counter`) plus `page` is now fully built; only `notes` (StickyWall-per-page,
// Phase 5 per PLAN.md) and `list` (never actually seen in real data this session) still get the
// honest "not yet built" placeholder instead of silently rendering nothing or crashing.
//
// This route lives at the app ROOT (not under (drawer)), so it gets no drawer/Stack safe-area
// treatment — without the top inset here every editor's header ran UNDER the Android status bar
// (the same "content behind the top bar" bug the drawer screens already fixed). Apply insets.top.
export default function PageDispatcherScreen() {
    const insets = useSafeAreaInsets()
    const { pageId } = useLocalSearchParams<{ pageId: string }>()
    const pageQuery = useQuery({ queryKey: ['page', pageId], queryFn: () => getPage(pageId) })

    function body() {
        if (pageQuery.isLoading) {
            return <View style={styles.centered}><Text style={styles.loadingText}>Loading…</Text></View>
        }
        if (pageQuery.isError || !pageQuery.data) {
            return <View style={styles.centered}><Text style={styles.emptyText}>Page not found.</Text></View>
        }

        const page = pageQuery.data
        const appid = Number(page.appid)

        if (page.type === 'page')          return <PageEditor page={page} appid={appid} />
        if (page.type === 'progress')      return <ProgressTracker page={page} appid={appid} />
        if (page.type === 'progress-bars') return <ProgressBarsTracker page={page} appid={appid} />
        if (page.type === 'counter')       return <CounterTracker page={page} appid={appid} />
        if (page.type === 'multi-counter') return <MultiCounterTracker page={page} appid={appid} />

        const NOT_YET_BUILT: Record<string, string> = {
            notes: 'Notes pages (StickyWall corkboard) are coming in a later phase.',
            list: 'List pages are coming soon.',
        }
        return (
            <View style={styles.centered}>
                <Text style={styles.title}>{page.title}</Text>
                <Text style={styles.emptyText}>{NOT_YET_BUILT[page.type] ?? 'This page type is not yet supported.'}</Text>
            </View>
        )
    }

    return <View style={[styles.root, { paddingTop: insets.top }]}>{body()}</View>
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, textAlign: 'center' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 18 },
})
