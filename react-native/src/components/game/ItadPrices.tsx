import { Feather } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { useGridColumns } from '@/hooks/useGridColumns'
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

// game.css `.itad-cards` = `grid-template-columns: repeat(4, 1fr)` at desktop, collapsing to
// `repeat(2, 1fr)` only at ≤1279px. There is no `minmax()` here — it's a fixed 4-up at the
// desktop tier — so parity means "up to 4 columns that fan out with width, floored at 2." The
// per-card slot at desktop is ~276px ((1136 − 3·10) / 4); a 240px min reaches 4 at the 1440dp
// tablet-landscape width (either rail state) and degrades to 2 on the phone tiers, capped at 4 so
// a collapsed-rail desktop never over-fans past the web's fixed four.
const ITAD_GAP = 10

export function ItadPrices({
    data, apiHost, refreshing, onRefresh,
}: {
    data: ItadData | null | undefined
    apiHost: string | undefined
    refreshing: boolean
    onRefresh: () => void
}) {
    const deals = (data?.deals ?? []).filter(d => !HIDDEN_STORES.has(d.store.toLowerCase()))
    const cols = useGridColumns(240, { gap: ITAD_GAP, horizontalPadding: spacing.md * 2, min: 2, max: 4 })
    // Actual inner width of the cards row (measured), divided into `cols` fixed-width slots so the
    // last partial row stays left-aligned at natural width — exactly like the web auto-fill grid.
    const [gridWidth, setGridWidth] = useState(0)
    const cardWidth = gridWidth > 0 ? Math.floor((gridWidth - ITAD_GAP * (cols - 1)) / cols) : 0

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
                            <Feather name="clock" size={13} color={colors.textMuted} />
                            <Text style={styles.historicLabel}>All-time low</Text>
                            <Text style={styles.historicPrice}>${data.historicalLow.price.toFixed(2)}</Text>
                            <Text style={styles.historicCut}>-{data.historicalLow.cut}%</Text>
                            <Text style={styles.historicMeta}>
                                {data.historicalLow.store}{data.historicalLow.date ? ` · ${data.historicalLow.date.slice(0, 4)}` : ''}
                            </Text>
                        </View>
                    )}
                    <View style={styles.cards} onLayout={e => setGridWidth(e.nativeEvent.layout.width)}>
                        {deals.map((d, i) => {
                            const iconSrc = storeIconSrc(d.store)
                            const isFanatical = d.store.toLowerCase() === 'fanatical'
                            const showMeta = d.cut > 0 || d.regular !== d.price
                            return (
                                <Pressable
                                    key={`${d.store}-${i}`}
                                    style={StyleSheet.flatten([styles.card, i === 0 && styles.cardBest, { width: cardWidth }])}
                                    onPress={() => d.url && Linking.openURL(d.url)}
                                >
                                    <View style={styles.cardLogo}>
                                        {iconSrc && apiHost && (
                                            <Image
                                                source={{ uri: `${apiHost}${iconSrc}` }}
                                                style={StyleSheet.flatten([styles.storeIcon, isFanatical && styles.storeIconFanatical])}
                                                contentFit="contain"
                                            />
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
    // `.itad-historic`: inline pill — clock icon + ALL-TIME LOW + price + green cut + store · year.
    historic: {
        flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
        paddingHorizontal: 14, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1, borderColor: colors.border, borderRadius: radius, marginBottom: 4,
    },
    historicLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
    historicPrice: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    historicCut: { color: '#5cba5c', fontFamily: fonts.uiBold, fontSize: 11 },
    historicMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    // Fixed-width slots (set inline from the measured row width) wrapped `cols` per row.
    cards: { flexDirection: 'row', flexWrap: 'wrap', gap: ITAD_GAP, marginTop: 12 },
    card: {
        alignItems: 'center', gap: 6, paddingTop: 18, paddingHorizontal: 12, paddingBottom: 14,
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius,
    },
    cardBest: { borderColor: colors.accent },
    cardLogo: { height: 52, width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 2, overflow: 'hidden' },
    storeIcon: { width: '100%', height: 52 },
    storeIconFanatical: { transform: [{ scale: 1.7 }] }, // `.itad-store-icon[data-store="fanatical"]`
    cardName: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, letterSpacing: 0.2 },
    cardPrice: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 20, lineHeight: 22 },
    cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 },
    // `.itad-cut` — tinted background + matching text color (NOT solid-fill white); ≥50% = green,
    // <50% = gold accent. overflow:hidden clips the radius on Android.
    cut: { fontSize: 11, fontFamily: fonts.uiBold, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 3, overflow: 'hidden' },
    cutHigh: { color: '#5cba5c', backgroundColor: 'rgba(92,186,92,0.15)' },
    cutMid: { color: colors.accent, backgroundColor: 'rgba(201,168,76,0.15)' },
    was: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textDecorationLine: 'line-through' },
})
