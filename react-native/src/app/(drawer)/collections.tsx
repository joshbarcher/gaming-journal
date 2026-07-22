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
import { colors, fonts, radius } from '@/theme/tokens'

// The five status collections, formerly five separate drawer screens, unified here behind a tab bar.
// Each tab renders the EXACT screen component the standalone route used (InProgress/Backlog/…), so
// the per-collection view is unchanged — only the navigation is consolidated (parity with the web
// /collections page). The legacy routes stay registered (see _layout.tsx) for deep links; the rail
// now shows one "Collections" entry.
//
// Only the active tab is mounted. Each screen loads via shared TanStack Query keys (['flags'],
// ['steamGamesList'], ['order',…], …) that stay warm in the cache, so switching tabs re-renders from
// cache without a visible refetch — no need to keep all five mounted.
const TABS: { id: string; label: string; countKey: keyof SidebarCounts; Screen: ComponentType }[] = [
    { id: 'in-progress', label: 'In Progress', countKey: 'inProgress', Screen: InProgressScreen },
    { id: 'backlog',     label: 'Backlog',     countKey: 'backlog',    Screen: BacklogScreen },
    { id: 'completed',   label: 'Completed',   countKey: 'completed',  Screen: HallOfFameScreen },
    { id: 'favorites',   label: 'Favorites',   countKey: 'favorites',  Screen: FavoritesScreen },
    { id: 'abandoned',   label: 'Abandoned',   countKey: 'dropped',    Screen: AbandonedScreen },
]

export default function CollectionsScreen() {
    const [active, setActive] = useState('in-progress')
    const { counts } = useSidebarCounts()

    // Align the tab bar's left edge with the content below it — same page padding the collection
    // screens compute internally.
    const breakpoint = useBreakpoint()
    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const pagePad = isPermanentRail ? 40 : breakpoint === 'mobileLandscapeTabletPortrait' ? 24 : 16

    const ActiveScreen = TABS.find(t => t.id === active)?.Screen ?? InProgressScreen

    return (
        <View style={styles.container}>
            <View style={styles.tabBarWrap}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={[styles.tabBar, { paddingHorizontal: pagePad }]}
                >
                    {TABS.map(t => {
                        const isActive = t.id === active
                        const count = counts?.[t.countKey] ?? 0
                        return (
                            <Pressable
                                key={t.id}
                                onPress={() => setActive(t.id)}
                                style={[styles.tab, isActive && styles.tabActive]}
                            >
                                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t.label}</Text>
                                {count > 0 && (
                                    <View style={[styles.tabCount, isActive && styles.tabCountActive]}>
                                        <Text style={[styles.tabCountText, isActive && styles.tabCountTextActive]}>{count}</Text>
                                    </View>
                                )}
                            </Pressable>
                        )
                    })}
                </ScrollView>
            </View>
            <View style={styles.body}>
                <ActiveScreen />
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    tabBarWrap: { paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    tabBar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius,
        backgroundColor: colors.bgRaised,
    },
    tabActive: { borderColor: colors.accent, backgroundColor: colors.accentBg },
    tabLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 13 },
    tabLabelActive: { color: colors.accent },
    tabCount: {
        minWidth: 18,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 9,
        backgroundColor: 'rgba(255,255,255,0.07)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabCountActive: { backgroundColor: colors.accent },
    tabCountText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10 },
    tabCountTextActive: { color: colors.bg },
    body: { flex: 1 },
})
