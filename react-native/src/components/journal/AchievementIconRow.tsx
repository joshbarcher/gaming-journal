import { Image } from 'expo-image'
import { StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import { cleanAchName } from '@/utils/journalRender'

// Shared by AchievementCard's "Recent" strip and LastSessionCard's earned-this-session icons —
// both render the same icon-grid shape on the web (AchievementStrip.svelte / SessionAchievements.svelte),
// differing only in the hover-tooltip mechanism, which doesn't apply on touch (no hover) — skipped
// entirely rather than ported to a tap-to-reveal gesture, a documented simplification.
export type AchIconEntry = { apiname: string; displayName?: string; icon?: string; localIcon?: string }

export function AchievementIconRow({ items, apiHost, max = 8 }: { items: AchIconEntry[]; apiHost: string | undefined; max?: number }) {
    if (!items.length) return null
    const visible = items.slice(0, max)
    const extra = items.length - max

    return (
        <View style={styles.row}>
            {visible.map((a, i) => {
                const name = a.displayName ?? cleanAchName(a.apiname)
                // localIcon is relay-relative ("/relay/images/steam/achievements/...") and needs the
                // apiHost prefix; icon is already an absolute Steam CDN URL — same distinction as
                // every other relay-image path in this app.
                const src = a.localIcon && apiHost ? `${apiHost}${a.localIcon}` : a.icon
                return (
                    <View key={`${a.apiname}-${i}`} style={styles.item}>
                        {src ? (
                            <Image source={{ uri: src }} style={styles.img} contentFit="cover" />
                        ) : (
                            <View style={[styles.img, styles.fallback]}>
                                <Text style={styles.fallbackText}>{name[0]?.toUpperCase() ?? '?'}</Text>
                            </View>
                        )}
                    </View>
                )
            })}
            {extra > 0 && <Text style={styles.more}>+{extra} more</Text>}
        </View>
    )
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    item: { width: 32, height: 32, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.bgHover },
    img: { width: '100%', height: '100%' },
    fallback: { alignItems: 'center', justifyContent: 'center' },
    fallbackText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 12 },
    more: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
})
