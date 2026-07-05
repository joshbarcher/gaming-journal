import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

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
export default function PageDispatcherScreen() {
    const { pageId } = useLocalSearchParams<{ pageId: string }>()
    const pageQuery = useQuery({ queryKey: ['page', pageId], queryFn: () => getPage(pageId) })

    if (pageQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading…</Text></View>
    }
    if (pageQuery.isError || !pageQuery.data) {
        return <View style={styles.container}><Text style={styles.emptyText}>Page not found.</Text></View>
    }

    const page = pageQuery.data
    const appid = Number(page.appid)

    if (page.type === 'page') {
        return <PageEditor page={page} appid={appid} />
    }
    if (page.type === 'progress') {
        return <ProgressTracker page={page} appid={appid} />
    }
    if (page.type === 'progress-bars') {
        return <ProgressBarsTracker page={page} appid={appid} />
    }
    if (page.type === 'counter') {
        return <CounterTracker page={page} appid={appid} />
    }
    if (page.type === 'multi-counter') {
        return <MultiCounterTracker page={page} appid={appid} />
    }

    const NOT_YET_BUILT: Record<string, string> = {
        notes: 'Notes pages (StickyWall corkboard) are coming in a later phase.',
        list: 'List pages are coming soon.',
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.emptyText}>{NOT_YET_BUILT[page.type] ?? 'This page type is not yet supported.'}</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, textAlign: 'center' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 18 },
})
