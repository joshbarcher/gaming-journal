import { Drawer } from 'expo-router/drawer'
import { Pressable, Text } from 'react-native'

import { CustomDrawerContent } from '@/components/shared/DrawerContent'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useGlobalSearchStore } from '@/store/globalSearchStore'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts } from '@/theme/tokens'

// Persistent search trigger — the touch replacement for the web's Ctrl+Space shortcut (no keyboard
// on touch). Shown in every screen's header via screenOptions, not a route-specific button.
function HeaderSearchButton() {
    const setOpen = useGlobalSearchStore(s => s.setOpen)
    return (
        <Pressable onPress={() => setOpen(true)} hitSlop={8} style={{ marginRight: 16 }}>
            <Text style={{ color: colors.accent, fontSize: 16 }}>Search</Text>
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
                sceneStyle:       { backgroundColor: colors.bg },
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
            <Drawer.Screen name="in-progress"  options={{ title: 'In Progress' }} />
            <Drawer.Screen name="backlog"      options={{ title: 'Backlog' }} />
            <Drawer.Screen name="favorites"    options={{ title: 'Favorites' }} />
            <Drawer.Screen name="abandoned"    options={{ title: 'Abandoned' }} />
            <Drawer.Screen name="hall-of-fame" options={{ title: 'Completed' }} />
            <Drawer.Screen name="franchises"   options={{ title: 'Franchises' }} />
            <Drawer.Screen name="my-reviews"   options={{ title: 'My Reviews' }} />
            <Drawer.Screen name="account"      options={{ title: 'Account' }} />
            <Drawer.Screen name="settings"     options={{ title: 'Settings' }} />
        </Drawer>
    )
}
