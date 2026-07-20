import { Feather } from '@expo/vector-icons'
import { ComponentProps } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { colors } from '@/theme/tokens'

type FeatherName = ComponentProps<typeof Feather>['name']

// Port of NavRail.svelte — the left-gutter section jump-nav shown at the wide/desktop tier (web hides
// it below 1280px, but tablet-landscape IS this app's desktop tier). A fixed vertical strip of icons
// that scroll-spies the active section and scrolls the page to a section on tap. Order + icons mirror
// game-sections.ts + SECTION_ICONS. `present` filters to sections that actually rendered on this game.
export const GAME_SECTIONS: { id: string; icon: FeatherName }[] = [
    { id: 'top',         icon: 'home' },
    { id: 'trailers',    icon: 'video' },
    { id: 'about',       icon: 'book-open' },
    { id: 'hltb',        icon: 'clock' },
    { id: 'players',     icon: 'bar-chart-2' },
    { id: 'screenshots', icon: 'image' },
    { id: 'news',        icon: 'file-text' },
    { id: 'localreview', icon: 'star' },
    { id: 'steamreview', icon: 'thumbs-up' },
    { id: 'community',   icon: 'message-circle' },
    { id: 'prices',      icon: 'tag' },
    { id: 'proton',      icon: 'award' },
    { id: 'pcgw',        icon: 'monitor' },
    { id: 'mods',        icon: 'package' },
]

export function GameSectionRail({ present, active, onJump }: {
    present: Set<string>
    active: string
    onJump: (id: string) => void
}) {
    const items = GAME_SECTIONS.filter(s => present.has(s.id))
    if (items.length < 2) return null
    return (
        <View style={styles.rail} pointerEvents="box-none">
            {items.map(s => {
                const on = s.id === active
                return (
                    <Pressable key={s.id} onPress={() => onJump(s.id)} hitSlop={4} style={[styles.btn, on && styles.btnActive]}>
                        {/* web `.gnr-btn`: idle opacity 0.38, active = accent + full opacity */}
                        <Feather name={s.icon} size={16} color={on ? colors.accent : colors.text} style={{ opacity: on ? 1 : 0.38 }} />
                    </Pressable>
                )
            })}
        </View>
    )
}

const styles = StyleSheet.create({
    rail: {
        position: 'absolute',
        left: 6,
        top: '28%',
        gap: 4,
        zIndex: 20,
    },
    btn: {
        width: 34,
        height: 34,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    btnActive: {
        backgroundColor: colors.bgRaised,
        borderColor: colors.border,
    },
})
