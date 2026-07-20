import { StyleSheet, Text, View } from 'react-native'

import { Lucide } from '@/components/shared/Lucide'
import { colors, fonts } from '@/theme/tokens'
import { releaseStatus } from '@/utils/gameRender'
import type { GameStore } from 'gaming-journal-contracts/gameDetail'

// Port of ReleaseBanner.svelte + game.css's .game-release-banner rules. Renders under the hero for
// coming-soon / early-access games; nothing for released (or unknown) titles. Colors/date wording
// match the web exactly ("⌛ Coming Soon — {date}" / "◎ Early Access — in Early Access since {date}").
export function ReleaseBanner({ store }: { store: GameStore | null | undefined }) {
    const status = releaseStatus(store)
    const dateStr = store?.releaseDate ?? ''

    if (status === 'coming_soon') {
        const lower = dateStr.toLowerCase()
        const datePart = dateStr && !['coming soon', 'tba', 'tbd'].includes(lower) ? ` — ${dateStr}` : ''
        return (
            <View style={[styles.banner, styles.soon, styles.bannerRow]}>
                <Lucide name="hourglass" color={colors.accent} size={15} />
                <Text style={[styles.text, styles.soonText]}>Coming Soon{datePart}</Text>
            </View>
        )
    }

    if (status === 'early_access') {
        const datePart = dateStr ? ` — in Early Access since ${dateStr}` : ''
        return (
            <View style={[styles.banner, styles.ea]}>
                <Text style={[styles.text, styles.eaText]}>◎  Early Access{datePart}</Text>
            </View>
        )
    }

    return null
}

const styles = StyleSheet.create({
    banner: { paddingVertical: 10, paddingHorizontal: 20, borderLeftWidth: 3 },
    bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    soon: { backgroundColor: 'rgba(180,120,20,0.15)', borderLeftColor: '#b07820' },
    ea: { backgroundColor: 'rgba(30,120,70,0.15)', borderLeftColor: '#1e7846' },
    text: { fontFamily: fonts.uiBold, fontSize: 13, letterSpacing: 0.3 },
    soonText: { color: '#d4a040' },
    eaText: { color: '#4cb87a' },
})
