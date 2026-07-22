import type { ComponentType } from 'react'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import AbandonedScreen from './abandoned'
import BacklogScreen from './backlog'
import FavoritesScreen from './favorites'
import HallOfFameScreen from './hall-of-fame'
import InProgressScreen from './in-progress'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useSidebarCounts, type SidebarCounts } from '@/hooks/useSidebarCounts'
import { colors, fonts } from '@/theme/tokens'

// The five status collections, unified behind one underline tab strip (parity with the web
// /collections page, Design A). Each tab renders the exact screen the standalone route used, in
// `embedded` mode: the screen's own tall header is dropped in favour of the shared tab strip + a
// compact meta line. `accent` is each collection's signature colour (mirrored from its screen), worn
// by the active tab's underline + count and the shared eyebrow. Only the active tab is mounted; the
// screens share TanStack Query keys so switching re-renders from cache without a visible refetch.
type Tab = { id: string; label: string; countKey: keyof SidebarCounts; accent: string; Screen: ComponentType<{ embedded?: boolean }> }

const TABS: Tab[] = [
    { id: 'in-progress', label: 'In Progress', countKey: 'inProgress', accent: '#e0a052', Screen: InProgressScreen },
    { id: 'backlog',     label: 'Backlog',     countKey: 'backlog',    accent: '#7c6fcd', Screen: BacklogScreen },
    { id: 'completed',   label: 'Completed',   countKey: 'completed',  accent: '#c9a84c', Screen: HallOfFameScreen },
    { id: 'favorites',   label: 'Favorites',   countKey: 'favorites',  accent: '#c45c7a', Screen: FavoritesScreen },
    { id: 'abandoned',   label: 'Abandoned',   countKey: 'dropped',    accent: '#c87941', Screen: AbandonedScreen },
]

export default function CollectionsScreen() {
    const [active, setActive] = useState('in-progress')
    const { counts } = useSidebarCounts()

    const breakpoint = useBreakpoint()
    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const pagePad = isPermanentRail ? 40 : breakpoint === 'mobileLandscapeTabletPortrait' ? 24 : 16

    const activeTab = TABS.find(t => t.id === active) ?? TABS[0]
    const ActiveScreen = activeTab.Screen

    return (
        <View style={styles.container}>
            <View style={[styles.tabBar, { paddingHorizontal: pagePad }]}>
                <Text style={[styles.eyebrow, { color: activeTab.accent }]}>Collections</Text>
                <View style={styles.tabRowWrap}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
                        {TABS.map(t => {
                            const isActive = t.id === active
                            const count = counts?.[t.countKey] ?? 0
                            return (
                                <Pressable key={t.id} onPress={() => setActive(t.id)} style={styles.tab}>
                                    <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t.label}</Text>
                                    {count > 0 && (
                                        <Text style={[styles.tabCount, isActive && { color: t.accent }]}>{count}</Text>
                                    )}
                                    {isActive && <View style={[styles.tabUnderline, { backgroundColor: t.accent }]} />}
                                </Pressable>
                            )
                        })}
                    </ScrollView>
                </View>
            </View>
            <View style={styles.body}>
                <ActiveScreen embedded />
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    tabBar: { paddingTop: 20 },
    eyebrow: { fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 12 },
    tabRowWrap: { borderBottomWidth: 1, borderBottomColor: colors.border },
    tabRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 24 },
    tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 12, position: 'relative' },
    tabLabel: { fontFamily: fonts.uiBold, fontSize: 15, color: colors.textMuted },
    tabLabelActive: { color: colors.text },
    tabCount: { fontFamily: fonts.uiBold, fontSize: 12, color: colors.textMuted, fontVariant: ['tabular-nums'] },
    tabUnderline: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, borderRadius: 2 },
    body: { flex: 1 },
})
