import { Image } from 'expo-image'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { ItadData } from 'gaming-journal-contracts/itad'

// Port of ItadPrices.svelte. Store icon assets (`/images/stores/*.svg|webp`) are real static files
// served through the same gateway as everything else — reused directly via apiHost prefix, same
// pattern as relay image paths, rather than skipped or re-drawn.
const HIDDEN_STORES = new Set(['gamesplanet uk', 'gamesplanet fr', 'gamesplanet de'])
const STORE_ICONS: Record<string, string> = {
    'humble store': 'humblestore', 'gamesplanet us': 'gamesplanet', steam: 'steam',
    greenmangaming: 'greenmangaming', fanatical: 'fanatical', gamebillet: 'gamebillet.webp',
}
function storeIconSrc(storeName: string): string | null {
    const file = STORE_ICONS[storeName.toLowerCase()]
    if (!file) return null
    return `/images/stores/${file.includes('.') ? file : `${file}.svg`}`
}

export function ItadPrices({
    data, apiHost, refreshing, onRefresh,
}: {
    data: ItadData | null | undefined
    apiHost: string | undefined
    refreshing: boolean
    onRefresh: () => void
}) {
    const deals = (data?.deals ?? []).filter(d => !HIDDEN_STORES.has(d.store.toLowerCase()))

    return (
        <View style={styles.section}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>Prices</Text>
                <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8}>
                    <Text style={styles.refreshBtn}>{refreshing ? '⟳' : '↻'}</Text>
                </Pressable>
            </View>

            {!deals.length ? (
                <Text style={styles.empty}>No price data available for this game.</Text>
            ) : (
                <>
                    {data?.historicalLow && (
                        <View style={styles.historic}>
                            <Text style={styles.historicLabel}>All-time low</Text>
                            <Text style={styles.historicPrice}>${data.historicalLow.price.toFixed(2)}</Text>
                            <Text style={styles.historicCut}>-{data.historicalLow.cut}%</Text>
                            <Text style={styles.historicMeta}>
                                {data.historicalLow.store}{data.historicalLow.date ? ` · ${data.historicalLow.date.slice(0, 4)}` : ''}
                            </Text>
                        </View>
                    )}
                    <View style={styles.cards}>
                        {deals.map((d, i) => {
                            const iconSrc = storeIconSrc(d.store)
                            const showMeta = d.cut > 0 || d.regular !== d.price
                            return (
                                <Pressable
                                    key={`${d.store}-${i}`}
                                    style={StyleSheet.flatten([styles.card, i === 0 && styles.cardBest])}
                                    onPress={() => d.url && Linking.openURL(d.url)}
                                >
                                    <View style={styles.cardLogo}>
                                        {iconSrc && apiHost && (
                                            <Image source={{ uri: `${apiHost}${iconSrc}` }} style={styles.storeIcon} contentFit="contain" />
                                        )}
                                    </View>
                                    <Text style={styles.cardName}>{d.store}</Text>
                                    <Text style={styles.cardPrice}>{d.price === 0 ? 'Free' : `$${d.price.toFixed(2)}`}</Text>
                                    {showMeta && (
                                        <View style={styles.cardMeta}>
                                            {d.cut > 0 && (
                                                <Text style={[styles.cut, d.cut >= 50 ? styles.cutHigh : styles.cutMid]}>-{d.cut}%</Text>
                                            )}
                                            {d.cut > 0 && <Text style={styles.was}>${d.regular.toFixed(2)}</Text>}
                                        </View>
                                    )}
                                </Pressable>
                            )
                        })}
                    </View>
                </>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, flex: 1 },
    refreshBtn: { color: colors.textMuted, fontSize: 16 },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    historic: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start',
        paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1, borderColor: colors.border, borderRadius: radius, marginBottom: spacing.sm,
    },
    historicLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase' },
    historicPrice: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    historicCut: { color: '#5cba5c', fontFamily: fonts.uiBold, fontSize: 11 },
    historicMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    // Base is 4 columns on desktop (game.css); ≤1279px collapses to 2 — since all 3 of this app's
    // required breakpoints are ≤1279px, and there's no further ≤479px override for `.itad-cards`
    // in the source (confirmed via grep), 2 columns is correct at every required tier uniformly.
    cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    card: {
        width: '48%', alignItems: 'center', gap: 4, paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius,
    },
    cardBest: { borderColor: colors.accent },
    cardLogo: { height: 44, width: '100%', alignItems: 'center', justifyContent: 'center' },
    storeIcon: { width: '80%', height: 44 },
    cardName: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    cardPrice: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 18 },
    cardMeta: { flexDirection: 'row', gap: 6, marginTop: 2 },
    cut: { fontSize: 11, fontFamily: fonts.uiBold, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 },
    cutHigh: { color: '#fff', backgroundColor: '#4c9a4c' },
    cutMid: { color: '#fff', backgroundColor: '#a07018' },
    was: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textDecorationLine: 'line-through' },
})
