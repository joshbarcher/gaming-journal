import { Feather } from '@expo/vector-icons'
import { Drawer } from 'expo-router/drawer'
import { Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CustomDrawerContent } from '@/components/shared/DrawerContent'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useGlobalSearchStore } from '@/store/globalSearchStore'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts } from '@/theme/tokens'

// Persistent global-search trigger — the touch replacement for the web's Ctrl+Space shortcut (no
// keyboard on touch). A magnifying-glass icon in every drawer screen's header (via screenOptions).
// Exported so the headerless detail screens (game/journal/community) can drop the same icon into
// their own in-content header rows and keep search reachable everywhere.
export function HeaderSearchButton({ color = colors.text }: { color?: string }) {
    const setOpen = useGlobalSearchStore(s => s.setOpen)
    return (
        <Pressable onPress={() => setOpen(true)} hitSlop={10} style={{ marginRight: 16 }} accessibilityLabel="Search">
            <Feather name="search" size={20} color={color} />
        </Pressable>
    )
}

export default function DrawerLayout() {
    const breakpoint = useBreakpoint()
    const { collapsed } = useSidebarStore()
    // Permanent, always-visible rail on tablet-landscape/desktop (matches web's fixed <aside> —
    // PLAN.md's mobile-drawer decision was made without weighing large-tablet-landscape screens;
    // confirmed with the user this should be responsive, not project-wide). Phone tiers keep the
    // original overlay drawer untouched.
    const isPermanentTier = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const drawerWidth = isPermanentTier && collapsed ? 68 : 280
    const insets = useSafeAreaInsets()

    return (
        <Drawer
            drawerContent={(props) => <CustomDrawerContent {...props} />}
            screenOptions={{
                headerStyle:      { backgroundColor: colors.bg },
                headerTintColor:  colors.text,
                headerTitleStyle: { fontFamily: fonts.title },
                headerRight:      () => <HeaderSearchButton />,
                drawerType:       isPermanentTier ? 'permanent' : 'front',
                drawerStyle:      { backgroundColor: colors.bgSidebar, width: drawerWidth, borderRightWidth: isPermanentTier ? 1 : 0, borderRightColor: colors.border },
                // Global bottom inset so no drawer screen's content runs under the Android nav bar.
                // (The header handles the top via SafeAreaProvider.) Individual screens can still add
                // their own aesthetic paddingBottom on top of this.
                sceneStyle:       { backgroundColor: colors.bg, paddingBottom: insets.bottom },
            }}
        >
            <Drawer.Screen name="index"        options={{ title: 'Home' }} />
            <Drawer.Screen name="library"      options={{ title: 'Steam Library' }} />
            <Drawer.Screen name="wishlist"     options={{ title: 'Wishlist' }} />
            <Drawer.Screen name="discover"     options={{ title: 'Discover' }} />
            <Drawer.Screen name="recommend"    options={{ title: 'Recommend' }} />
            <Drawer.Screen name="downloads"    options={{ title: 'Downloads' }} />
            <Drawer.Screen name="alerts"       options={{ title: 'Sale Alerts' }} />
            <Drawer.Screen name="calendar"     options={{ title: 'Calendar' }} />
            <Drawer.Screen name="top-games"    options={{ title: 'Top Games' }} />
            <Drawer.Screen name="history"      options={{ title: 'History' }} />
            <Drawer.Screen name="playing"      options={{ title: 'Playing' }} />
            <Drawer.Screen name="collections"  options={{ title: 'Collections' }} />
            <Drawer.Screen name="franchises"   options={{ title: 'Franchises' }} />
            <Drawer.Screen name="my-reviews"   options={{ title: 'My Reviews' }} />
            <Drawer.Screen name="account"      options={{ title: 'Account' }} />
            <Drawer.Screen name="settings"     options={{ title: 'Settings' }} />
            {/* Legacy status-collection routes folded into /collections. Kept registered so deep
                links / direct navigation still resolve, but hidden from the rail (which is driven by
                DrawerContent's NAV_ITEMS, not by these registrations). */}
            <Drawer.Screen name="in-progress"  options={{ title: 'In Progress', drawerItemStyle: { display: 'none' } }} />
            <Drawer.Screen name="backlog"      options={{ title: 'Backlog',     drawerItemStyle: { display: 'none' } }} />
            <Drawer.Screen name="favorites"    options={{ title: 'Favorites',   drawerItemStyle: { display: 'none' } }} />
            <Drawer.Screen name="abandoned"    options={{ title: 'Abandoned',   drawerItemStyle: { display: 'none' } }} />
            <Drawer.Screen name="hall-of-fame" options={{ title: 'Completed',   drawerItemStyle: { display: 'none' } }} />
            {/* Detail routes: inside the drawer so the permanent rail persists, but hidden from the
                rail's item list and with no drawer app-bar (each has its own nested headerless stack
                + in-content chrome). */}
            <Drawer.Screen name="game"      options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
            <Drawer.Screen name="journal"   options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
            <Drawer.Screen name="community" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
            <Drawer.Screen name="franchise" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
        </Drawer>
    )
}
