import { useQuery } from '@tanstack/react-query'
import { Feather } from '@expo/vector-icons'
import { router } from 'expo-router'
import { DrawerContentScrollView, DrawerItem, type DrawerContentComponentProps } from 'expo-router/drawer'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Image as RNImage, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getAlerts } from '@/api/alerts'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useHomeData } from '@/hooks/useHomeData'
import { useNowPlaying } from '@/hooks/useNowPlaying'
import { useSidebarCounts, type SidebarCounts } from '@/hooks/useSidebarCounts'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// Mirrors global/sidebar.md's item list + counts exactly (pulled straight from Sidebar.svelte's
// data-id/href/data-tooltip attributes, not guessed). Community isn't here on purpose — it's
// nested under /game/{appid}/community, not a top-level nav destination. Icon choices are our own
// (Feather, closest available set to the web's outline icons) — the web's inline SVGs aren't a
// portable asset, so these are picked for closest semantic/shape match, not a literal port.
const NAV_ITEMS: {
    route: string; label: string; icon: keyof typeof Feather.glyphMap
    countKey?: keyof SidebarCounts; badgeVariant?: 'alert'; hasBackdrop?: boolean
}[] = [
    { route: 'index',        label: 'Home',           icon: 'home' },
    { route: 'library',      label: 'Steam Library',  icon: 'bar-chart-2', countKey: 'library' },
    { route: 'wishlist',     label: 'Wishlist',       icon: 'star',        countKey: 'wishlist' },
    { route: 'discover',     label: 'Discover',       icon: 'compass' },
    { route: 'recommend',    label: 'Recommend',      icon: 'shuffle' },
    { route: 'downloads',    label: 'Downloads',      icon: 'download' },
    { route: 'alerts',       label: 'Sale Alerts',    icon: 'zap',         countKey: 'onSale', badgeVariant: 'alert' },
    { route: 'calendar',     label: 'Calendar',       icon: 'calendar' },
    { route: 'top-games',    label: 'Top Games',      icon: 'trending-up' },
    { route: 'history',      label: 'History',        icon: 'clock',       hasBackdrop: true },
    { route: 'playing',      label: 'Playing',        icon: 'play',        countKey: 'playlist' },
    { route: 'collections',  label: 'Collections',    icon: 'grid',        countKey: 'collections' },
    { route: 'franchises',   label: 'Franchises',     icon: 'layers',      countKey: 'franchises' },
    { route: 'my-reviews',   label: 'My Reviews',     icon: 'edit-3' },
    { route: 'account',      label: 'Account',        icon: 'user' },
    { route: 'settings',     label: 'Settings',       icon: 'settings' },
]

const clampPx = (min: number, ratio: number, windowHeight: number, max: number) =>
    Math.min(max, Math.max(min, windowHeight * ratio))

// Piecewise-linear inverse of sidebar.css's mask-image stops (transparent 0%, 0.4 alpha @ 40%,
// 0.85 alpha @ 75%, opaque 100%) — overlay alpha = 1 - image alpha, so the image stays mostly
// hidden until well past the midpoint, matching the web's slow, long reveal.
function historyFadeAlpha(t: number): number {
    if (t <= 0.4)  return 1    - (t / 0.4) * 0.4
    if (t <= 0.75) return 0.6  - ((t - 0.4) / 0.35) * 0.45
    return 0.15 - ((t - 0.75) / 0.25) * 0.15
}
const HISTORY_FADE_BANDS = 20

// Neither `expo-linear-gradient` nor a plain-View overlay ever painted on top of the `expo-image`
// background here (confirmed empirically twice — even a flat opaque test color painted nothing) —
// consistent with expo-image rendering this content through an Android SurfaceView-backed layer,
// which composites above the normal View hierarchy regardless of sibling/JSX order. Swapped to
// plain React Native `Image` (aliased `RNImage`) for just this decorative backdrop — no
// SurfaceView, so ordinary sibling paint order applies and the fade bands can render on top.
function HistoryBackdrop({ uri }: { uri: string }) {
    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={styles.historyBackdropWrap}>
                <RNImage source={{ uri }} style={styles.bgFill} resizeMode="cover" />
                <View style={[StyleSheet.absoluteFill, styles.historyFadeRow]}>
                    {Array.from({ length: HISTORY_FADE_BANDS }, (_, i) => (
                        <View
                            key={i}
                            style={[styles.historyFadeBand, { backgroundColor: `rgba(10,9,8,${historyFadeAlpha(i / (HISTORY_FADE_BANDS - 1))})` }]}
                        />
                    ))}
                </View>
            </View>
        </View>
    )
}

// Port of Sidebar.svelte's Now Playing / Last Session card (public/css/sidebar.css). The web card
// signals an ACTIVE session two ways, both of which the native card was missing:
//   • `.now-playing-card` runs @keyframes np-glow (2.5s): a pulsing box-shadow bloom + a
//     border-color pulse (gold 0.45→0.95).
//   • `.now-playing-orbit`/`.now-playing-particle` run @keyframes np-rotate (4s linear): a glowing
//     spark orbiting the card's center — the "spinning glow".
// Both are suppressed for the last-session fallback (`.now-playing-wrap--last { animation:none }`,
// dimmed to 0.55) — so here they render ONLY while `playing` is truthy.
//
// How the effects are built in RN:
//   • Glow: box-shadow can't be animated portably (see LastSessionCard.tsx's note), so the bloom is
//     a gold halo ring inset just OUTSIDE the card whose OPACITY pulses (native-driver-safe). Keeping
//     it outside the card edge also sidesteps expo-image's Android over-compositing — it never
//     overlaps the header art, so it can't be swallowed by the image's SurfaceView layer.
//   • Spinning glow: a real rotating transform loop. A zero-size pivot sits at the card's center
//     (top/left 50%); the spark hangs `orbitRadius` above it, so interpolating the pivot's rotation
//     0deg→360deg sweeps the spark in a circle around the card — the exact zero-size-pivot trick the
//     web's `.now-playing-orbit` uses.
function NowPlayingCard({ playing, appid, image, name, collapsed }: {
    playing: boolean
    appid: number | undefined
    image: string | undefined
    name: string
    collapsed: boolean
}) {
    const glow = useRef(new Animated.Value(0)).current // 0 → dim, 1 → bright
    const spin = useRef(new Animated.Value(0)).current // 0 → 1 maps to 0° → 360°

    useEffect(() => {
        if (!playing) return
        // np-glow: symmetric ease in/out, ~2.5s round trip (1.25s each way).
        const pulse = Animated.loop(Animated.sequence([
            Animated.timing(glow, { toValue: 1, duration: 1250, useNativeDriver: true }),
            Animated.timing(glow, { toValue: 0, duration: 1250, useNativeDriver: true }),
        ]))
        // np-rotate: one full turn every 4s, linear, forever.
        const orbit = Animated.loop(
            Animated.timing(spin, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: true }),
        )
        pulse.start()
        orbit.start()
        return () => { pulse.stop(); orbit.stop() }
    }, [playing, glow, spin])

    const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
    // Mirrors np-glow's box-shadow alpha swing (0.2 → 0.55) + border brighten (0.45 → 0.95).
    const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.85] })

    const orbitRadius = collapsed ? 24 : 46
    const spark = collapsed ? 5 : 7
    const sizeStyle = collapsed ? styles.nowPlayingCardCollapsed : null

    return (
        <Pressable
            style={styles.nowPlayingWrap}
            disabled={appid == null}
            onPress={() => { if (appid != null) router.push(`/game/${appid}` as never) }}
        >
            {/* Pulsing gold bloom, ringing just outside the card edge (np-glow's box-shadow). */}
            {playing && (
                <Animated.View pointerEvents="none" style={[styles.nowPlayingGlow, { opacity: glowOpacity }]} />
            )}

            <View style={[styles.nowPlayingCard, sizeStyle, playing ? styles.nowPlayingCardActive : styles.nowPlayingCardLast]}>
                {image && (
                    <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" />
                )}
                <LinearGradient
                    colors={['rgba(8,7,6,0)', 'rgba(8,7,6,0.75)', 'rgba(8,7,6,0.97)']}
                    style={StyleSheet.absoluteFill}
                />
                {!collapsed && (
                    <View style={styles.nowPlayingBody}>
                        <Text style={[styles.nowPlayingLabel, playing && styles.nowPlayingLabelActive]}>
                            {playing ? 'Now Playing' : 'Last Session'}
                        </Text>
                        <Text style={styles.nowPlayingName} numberOfLines={1}>{name}</Text>
                    </View>
                )}
            </View>

            {/* "Spinning glow": glowing spark on a zero-size pivot at card center, swept 0°→360°. */}
            {playing && (
                <Animated.View pointerEvents="none" style={[styles.nowPlayingOrbit, { transform: [{ rotate }] }]}>
                    <View
                        style={[
                            styles.nowPlayingSpark,
                            { top: -orbitRadius, width: spark * 3, height: spark * 3, borderRadius: spark * 1.5, marginLeft: -spark * 1.5 },
                        ]}
                    >
                        <View style={[styles.nowPlayingSparkCore, { width: spark, height: spark, borderRadius: spark / 2 }]} />
                    </View>
                </Animated.View>
            )}
        </Pressable>
    )
}

export function CustomDrawerContent(props: DrawerContentComponentProps) {
    const nowPlayingQuery = useNowPlaying()
    const homeQuery = useHomeData()
    const { counts } = useSidebarCounts()
    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const { height: windowHeight } = useWindowDimensions()
    const { collapsed, toggle } = useSidebarStore()
    // Rail needs BOTH insets: the Now Playing card sat under the status bar (top) and the bottom
    // items under the nav bar (bottom).
    const insets = useSafeAreaInsets()

    const playing = nowPlayingQuery.data?.playing
    const resume = homeQuery.data?.resume
    const apiHost = apiHostQuery.data
    const isPermanentTier = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const isCollapsed = isPermanentTier && collapsed

    // No dedicated "last played session" endpoint exists yet (would need the same server-side
    // history-scan +layout.server.ts does) — the Home screen's own `resume` (most recent
    // resumable game) is already fetched and deduped via TanStack Query's cache, so it stands in
    // as the "last session" fallback here rather than adding a second, narrower contract for it.
    const nowPlayingAppid = playing?.appid ?? (!playing ? resume?.appid : undefined)
    const nowPlayingImage = apiHost && nowPlayingAppid
        ? `${apiHost}/relay/images/steam/games/${nowPlayingAppid}/header.jpg`
        : undefined
    // Sidebar.svelte's `store.historyAppid` is literally the same appid this same session-history
    // computation already resolves for `resume`/lastPlayed — no separate contract needed.
    const historyBackdropUri = nowPlayingImage

    // Sale Alerts nav backdrop (mirrors Sidebar.svelte): one on-sale game per wall-clock hour,
    // stable across navigations. Reuses the already-cached ['alerts'] query (useSidebarCounts fetches
    // it), so no extra request. Native was missing this backdrop + the green cut tag entirely.
    const alertsQuery = useQuery({ queryKey: ['alerts'], queryFn: getAlerts })
    const onSale = alertsQuery.data?.onSale ?? []
    const saleBucket = Math.floor(Date.now() / 3_600_000)
    const currentSale = onSale.length
        ? [...onSale].sort((a, b) => a.appid - b.appid)[Math.abs(Math.imul(saleBucket ^ 0x9e3779b9, 2654435761)) % onSale.length]
        : null
    const saleBackdropUri = apiHost && currentSale ? `${apiHost}/relay/images/steam/games/${currentSale.appid}/header.jpg` : undefined
    const saleCut = currentSale?.bestPrice?.cut ?? null

    const nowPlayingCard = (playing || resume) && (
        <NowPlayingCard
            playing={!!playing}
            appid={nowPlayingAppid}
            image={nowPlayingImage}
            name={playing?.name ?? resume?.name ?? `App ${nowPlayingAppid}`}
            collapsed={isCollapsed}
        />
    )

    const gutterBtn = isPermanentTier && (
        // Ports layout.svelte's .sidebar-gutter-btn: a small fixed tab attached to the sidebar's
        // edge, vertically centered — NOT part of the scrollable/fitted nav list, so it stays
        // reachable regardless of the list's own layout. Pinned to the inner edge (not hanging
        // past the drawer's right border like web) since RN Navigation's drawer container clips
        // overflow, unlike web's `overflow: visible` aside.
        <Pressable onPress={toggle} style={styles.gutterBtn} hitSlop={8}>
            <Feather name={collapsed ? 'chevrons-right' : 'chevrons-left'} size={14} color={colors.textMuted} />
        </Pressable>
    )

    // Permanent tier ports #sidebar-nav's desktop rule exactly: `overflow: hidden` + a
    // viewport-height clamp on gaps/padding so every item fits without scrolling, rather than
    // `overflow-y: auto` (that's the mobile-only rule). A fixed compact row size — computed from
    // window height, same idea as the web's `clamp(4px, 0.85vh, 8px)` — replaces
    // DrawerContentScrollView + the stock DrawerItem (whose built-in min sizing can't shrink
    // enough to guarantee all 18 items + Now Playing fit on shorter tablet-landscape heights).
    if (isPermanentTier) {
        const rowPadV = clampPx(3, 0.0085, windowHeight, 7) // mirrors sidebar.css's clamp(4px, 0.85vh, 8px)
        const rowGap = clampPx(1, 0.003, windowHeight, 4)   // mirrors #sidebar-nav's clamp(1px, 0.3vh, 4px)
        return (
            <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
                <View style={[styles.container, styles.fitted, isCollapsed && styles.containerCollapsed, { gap: rowGap }]}>
                    {nowPlayingCard}
                    {NAV_ITEMS.map(item => {
                        const count = item.countKey ? counts?.[item.countKey] : undefined
                        const focused = props.state.routes[props.state.index]?.name === item.route
                        if (isCollapsed) {
                            return (
                                <Pressable
                                    key={item.route}
                                    onPress={() => props.navigation.navigate(item.route)}
                                    style={[styles.collapsedItem, focused && styles.collapsedItemActive]}
                                >
                                    <Feather name={item.icon} size={18} color={focused ? colors.accent : colors.text} />
                                    {typeof count === 'number' && count > 0 && (
                                        <View style={[styles.collapsedDot, item.badgeVariant === 'alert' && styles.collapsedDotAlert]} />
                                    )}
                                </Pressable>
                            )
                        }
                        return (
                            <Pressable
                                key={item.route}
                                onPress={() => props.navigation.navigate(item.route)}
                                style={[styles.fittedRow, { paddingVertical: rowPadV }, focused && styles.fittedRowActive]}
                            >
                                {item.route === 'history' && historyBackdropUri && <HistoryBackdrop uri={historyBackdropUri} />}
                                {item.route === 'alerts' && saleBackdropUri && (
                                    <>
                                        <HistoryBackdrop uri={saleBackdropUri} />
                                        {saleCut != null && saleCut > 0 && <Text style={styles.saleCutTag}>-{saleCut}%</Text>}
                                    </>
                                )}
                                <Feather name={item.icon} size={16} color={focused ? colors.accent : colors.text} />
                                <Text style={[styles.fittedRowLabel, focused && styles.fittedRowLabelActive]} numberOfLines={1}>
                                    {item.label}
                                </Text>
                                {typeof count === 'number' && count > 0 && (
                                    <View style={[styles.badge, item.badgeVariant === 'alert' && styles.badgeAlert]}>
                                        <Text style={[styles.badgeText, item.badgeVariant === 'alert' && styles.badgeTextAlert]}>{count}</Text>
                                    </View>
                                )}
                            </Pressable>
                        )
                    })}
                </View>
                {gutterBtn}
            </View>
        )
    }

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <DrawerContentScrollView {...props} style={styles.container}>
                {nowPlayingCard}
                {NAV_ITEMS.map(item => {
                    const count = item.countKey ? counts?.[item.countKey] : undefined
                    const focused = props.state.routes[props.state.index]?.name === item.route
                    const label = typeof count === 'number' && count > 0 ? `${item.label} (${count})` : item.label
                    return (
                        <DrawerItem
                            key={item.route}
                            label={label}
                            labelStyle={styles.itemLabel}
                            icon={({ color, size }) => <Feather name={item.icon} size={size} color={color} />}
                            activeTintColor={colors.accent}
                            inactiveTintColor={colors.text}
                            focused={focused}
                            onPress={() => props.navigation.navigate(item.route)}
                        />
                    )
                })}
            </DrawerContentScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    container: {
        backgroundColor: colors.bgSidebar,
    },
    fitted: {
        flex:           1,
        // Space-between spreads Now Playing + all 18 items evenly across the sidebar's full
        // height instead of clumping them at the top with dead space below Settings — a real
        // flexbox distribution, not just a tight top-packed list with leftover room.
        justifyContent: 'space-between',
        paddingHorizontal: spacing.sm,
        paddingVertical:   spacing.sm,
    },
    containerCollapsed: {
        alignItems: 'center',
    },
    // Wrap is the tap target + positioning context. It is NOT clipped, so the glow bloom and the
    // orbiting spark can extend past the card's edges (the card itself is clipped for its rounded
    // header art). Mirrors .now-playing-wrap (position:relative) + the <a>.now-playing-card split.
    nowPlayingWrap: {
        position:     'relative',
        marginBottom: spacing.xs,
    },
    nowPlayingCard: {
        height:         80,
        borderRadius:   radius,
        borderWidth:    1,
        overflow:       'hidden',
        justifyContent: 'flex-end',
    },
    // .now-playing-card active: gold border + faint accent wash (np-glow's box-shadow carries motion).
    nowPlayingCardActive: {
        borderColor:     'rgba(201, 168, 76, 0.55)',
        backgroundColor: colors.accentBg,
    },
    // .now-playing-wrap--last: static, dim (opacity 0.55), faint white border, no glow.
    nowPlayingCardLast: {
        borderColor:     'rgba(255, 255, 255, 0.12)',
        backgroundColor: 'transparent',
        opacity:         0.55,
    },
    nowPlayingCardCollapsed: {
        height: 44,
        width:  44,
    },
    // Pulsing bloom ring — inset OUTSIDE the card edge (np-glow's expanding gold box-shadow).
    nowPlayingGlow: {
        position:     'absolute',
        top:          -3,
        left:         -3,
        right:        -3,
        bottom:       -3,
        borderRadius: radius + 2,
        borderWidth:  2,
        borderColor:  'rgba(201, 168, 76, 0.9)',
        // Soft outer bloom on iOS; Android leans on the translucent ring above.
        shadowColor:   '#c9a84c',
        shadowOpacity: 0.85,
        shadowRadius:  10,
        shadowOffset:  { width: 0, height: 0 },
    },
    // Zero-size pivot at the card's center; the spark child hangs above it and is swept around by
    // the rotating transform — the same technique as .now-playing-orbit.
    nowPlayingOrbit: {
        position: 'absolute',
        top:      '50%',
        left:     '50%',
        width:    0,
        height:   0,
        zIndex:   10,
    },
    // Glowing spark: translucent gold halo (the "glow") wrapping a bright white core.
    nowPlayingSpark: {
        position:        'absolute',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'rgba(201, 168, 76, 0.3)',
        shadowColor:     '#c9a84c',
        shadowOpacity:   0.9,
        shadowRadius:    6,
        shadowOffset:    { width: 0, height: 0 },
    },
    nowPlayingSparkCore: {
        backgroundColor: '#fff',
        shadowColor:     '#fff',
        shadowOpacity:   1,
        shadowRadius:    3,
        shadowOffset:    { width: 0, height: 0 },
    },
    nowPlayingBody: {
        padding: spacing.sm,
    },
    nowPlayingLabel: {
        color:      colors.textMuted,
        fontFamily: fonts.ui,
        fontSize:   10,
        textTransform: 'uppercase',
    },
    // .now-playing-eyebrow (active): accent gold, not muted.
    nowPlayingLabelActive: {
        color: colors.accent,
    },
    nowPlayingName: {
        color:      colors.text,
        fontFamily: fonts.uiBold,
        fontSize:   13,
        marginTop:  2,
    },
    itemLabel: {
        color:      colors.text,
        fontFamily: fonts.ui,
        fontSize:   14,
    },
    fittedRow: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               spacing.sm,
        paddingHorizontal: spacing.sm,
        borderRadius:      radius,
        borderWidth:       1,
        borderColor:       colors.border,
        // No overflow:'hidden' here on purpose — confirmed empirically it silently drops the
        // History backdrop's whole fade-overlay layer (not just corner-clipping it) on this
        // Android build, when combined with the nested absolutely-positioned Image+overlay. The
        // 3px corner radius makes the resulting un-clipped image corner imperceptible in practice.
    },
    fittedRowActive: {
        backgroundColor: colors.accentBg,
        borderColor:      'rgba(201, 168, 76, 0.25)',
        borderLeftWidth:  3,
        borderLeftColor:  colors.accent,
    },
    fittedRowLabel: {
        flex:       1,
        color:      colors.text,
        fontFamily: fonts.ui,
        fontSize:   12,
    },
    fittedRowLabelActive: {
        color: colors.accent,
    },
    bgFill: {
        width:  '100%',
        height: '100%',
    },
    historyBackdropWrap: {
        position: 'absolute',
        top: 0, right: 0, bottom: 0,
        width: '55%',
        opacity: 0.75,
    },
    historyFadeRow: {
        flexDirection: 'row',
    },
    historyFadeBand: {
        flex:   1,
        height: '100%',
    },
    // De-emphasized pill, right-aligned via fittedRowLabel's flex:1 pushing it to the row's end —
    // ports sidebar.css's .sidebar-collection-badge (muted) / .sidebar-alerts-badge (green) exactly.
    saleCutTag: {
        position:          'absolute',
        right:             spacing.sm,
        bottom:            3,
        color:             '#5fd88a',
        fontFamily:        fonts.uiBold,
        fontSize:          9,
    },
    badge: {
        minWidth:          20,
        height:            20,
        paddingHorizontal: 5,
        borderRadius:      10,
        alignItems:        'center',
        justifyContent:    'center',
        backgroundColor:   'rgba(255, 255, 255, 0.07)',
    },
    badgeAlert: {
        backgroundColor: '#3a9c3a',
    },
    badgeText: {
        color:      colors.textMuted,
        fontFamily: fonts.uiBold,
        fontSize:   10,
    },
    badgeTextAlert: {
        color: '#fff',
    },
    collapsedItem: {
        width:          40,
        height:         36,
        alignItems:     'center',
        justifyContent: 'center',
        borderRadius:   radius,
    },
    collapsedItemActive: {
        backgroundColor: colors.accentBg,
    },
    collapsedDot: {
        position:        'absolute',
        top:             4,
        right:           6,
        width:           6,
        height:          6,
        borderRadius:    3,
        backgroundColor: colors.accent,
    },
    collapsedDotAlert: {
        backgroundColor: '#3a9c3a',
    },
    gutterBtn: {
        position:        'absolute',
        top:             '50%',
        marginTop:       -24,
        right:           0,
        width:           18,
        height:          48,
        alignItems:      'center',
        justifyContent:  'center',
        borderWidth:     1,
        borderColor:     colors.border,
        borderTopLeftRadius:    radius,
        borderBottomLeftRadius: radius,
        backgroundColor: colors.bgSidebar,
    },
})
