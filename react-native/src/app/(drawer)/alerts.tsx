import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { getAlerts } from '@/api/alerts'
import { useApiHost } from '@/hooks/useApiHost'
import { useGridColumns } from '@/hooks/useGridColumns'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { AlertResult } from 'gaming-journal-contracts/alerts'

// Port of Alerts.svelte (Sale Alerts). The web derives onSale/watching client-side by fetching
// flags → per-game ITAD prices progressively; the server already exposes the identical computation
// at GET /api/alerts (alertsService.getAlerts → { onSale, watching }, onSale sorted by cut desc,
// both lists filtered to non-library games). Per the brief we consume that endpoint rather than
// rebuilding a parallel ITAD pipeline — so there's no "checking prices…" progressive state; the
// query is either loading or fully resolved.

// AlertResult.historicalLow is typed `unknown` in the contract (the ITAD low shape isn't pinned
// server-side). Narrow it defensively for rendering rather than trusting a cast.
type HistoricalLow = { price: number; store: string; date?: string }
function readHistoricalLow(hl: unknown): HistoricalLow | null {
    if (hl && typeof hl === 'object') {
        const h = hl as Record<string, unknown>
        if (typeof h.price === 'number') {
            return {
                price: h.price,
                store: typeof h.store === 'string' ? h.store : '',
                date: typeof h.date === 'string' ? h.date : undefined,
            }
        }
    }
    return null
}

export default function AlertsScreen() {
    const alertsQuery = useQuery({ queryKey: ['alerts'], queryFn: getAlerts })
    const apiHost = useApiHost().data
    // Fluid columns mirroring the web `.alerts-onsale-grid` = `minmax(260px, 1fr)`. Driven by the
    // measured content width (window − rail − list padding), so tablet-landscape (1440dp) fans out
    // to the web's ~4 columns instead of the old fixed 2.
    const onSaleCols = useGridColumns(260, { horizontalPadding: spacing.md * 2 })

    if (alertsQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading alerts…</Text></View>
    }
    if (alertsQuery.error) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>Failed to load alerts: {(alertsQuery.error as Error).message}</Text>
            </View>
        )
    }

    const onSale = alertsQuery.data?.onSale ?? []
    const watching = alertsQuery.data?.watching ?? []

    if (onSale.length === 0 && watching.length === 0) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>Sale Alerts</Text>
                </View>
                <Text style={styles.emptyText}>
                    No games flagged for sale alerts yet. Open any game page and toggle the Bell flag to start watching it.
                </Text>
            </View>
        )
    }

    const subtitle = onSale.length > 0
        ? `${onSale.length} game${onSale.length !== 1 ? 's' : ''} on sale now`
        : 'No watched games are on sale right now'

    const header = (
        <View>
            <View style={styles.header}>
                <Text style={styles.title}>Sale Alerts</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            {onSale.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>On Sale Now</Text>
                    <View style={styles.onSaleGrid}>
                        {onSale.map(game => (
                            <View key={game.appid} style={[styles.onSaleCell, { width: `${100 / onSaleCols}%` }]}>
                                <OnSaleCard game={game} apiHost={apiHost} />
                            </View>
                        ))}
                    </View>
                </View>
            )}

            {onSale.length > 0 && watching.length > 0 && (
                <Text style={[styles.sectionTitle, styles.sectionTitleMuted]}>Watching</Text>
            )}
        </View>
    )

    return (
        <View style={styles.container}>
            <FlatList
                data={watching}
                keyExtractor={(item) => String(item.appid)}
                ListHeaderComponent={header}
                contentContainerStyle={styles.listContent}
                initialNumToRender={16}
                windowSize={7}
                removeClippedSubviews
                renderItem={({ item }) => <WatchRow game={item} apiHost={apiHost} />}
            />
        </View>
    )
}

function OnSaleCard({ game, apiHost }: { game: AlertResult; apiHost: string | undefined }) {
    const cut = game.bestPrice?.cut ?? 0
    const price = game.bestPrice?.price ?? null
    const store = game.bestPrice?.store ?? ''
    const hl = readHistoricalLow(game.historicalLow)
    return (
        <Link href={`/game/${game.appid}` as never} asChild>
            <Pressable style={styles.card}>
                <View style={styles.cardImgWrap}>
                    {apiHost && (
                        <Image
                            source={{ uri: `${apiHost}/relay/images/steam/games/${game.appid}/header.jpg` }}
                            style={styles.cardImg}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={String(game.appid)}
                        />
                    )}
                    <View style={styles.cutBadge}><Text style={styles.cutText}>-{cut}%</Text></View>
                </View>
                <View style={styles.cardBody}>
                    <Text style={styles.cardName} numberOfLines={1}>{game.name}</Text>
                    <View style={styles.pricing}>
                        {price != null && <Text style={styles.price}>${price.toFixed(2)}</Text>}
                        {!!store && <Text style={styles.store}>{store}</Text>}
                    </View>
                    {hl && (
                        <Text style={styles.hl}>
                            All-time low: ${hl.price.toFixed(2)} · {hl.store}{hl.date ? ` (${hl.date.slice(0, 4)})` : ''}
                        </Text>
                    )}
                </View>
            </Pressable>
        </Link>
    )
}

function WatchRow({ game, apiHost }: { game: AlertResult; apiHost: string | undefined }) {
    const price = game.bestPrice?.price ?? null
    const store = game.bestPrice?.store ?? ''
    return (
        <Link href={`/game/${game.appid}` as never} asChild>
            <Pressable style={styles.watchRow}>
                {apiHost && (
                    <Image
                        source={{ uri: `${apiHost}/relay/images/steam/games/${game.appid}/header.jpg` }}
                        style={styles.watchImg}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={String(game.appid)}
                    />
                )}
                <Text style={styles.watchName} numberOfLines={1}>{game.name}</Text>
                <Text style={styles.watchPrice}>
                    {price != null ? `$${price.toFixed(2)}` : '—'}
                    {!!store && <Text style={styles.watchStore}> · {store}</Text>}
                </Text>
            </Pressable>
        </Link>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    errorText: { color: colors.accent2, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, lineHeight: 20 },
    listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },

    header: { paddingTop: spacing.md, paddingBottom: spacing.md, gap: 4 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 26 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, marginTop: 2 },

    section: { marginBottom: spacing.lg },
    sectionTitle: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md },
    sectionTitleMuted: { opacity: 0.5, marginTop: spacing.xs },

    onSaleGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    onSaleCell: { padding: spacing.xs },

    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden',
    },
    cardImgWrap: { position: 'relative', width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    cardImg: { width: '100%', height: '100%' },
    cutBadge: {
        position: 'absolute', top: 10, right: 10, backgroundColor: '#3a9c3a',
        borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5,
    },
    cutText: { color: '#fff', fontFamily: fonts.uiBold, fontSize: 18, letterSpacing: -0.3 },
    cardBody: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 5 },
    cardName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    pricing: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    price: { color: '#5cb85c', fontFamily: fonts.uiBold, fontSize: 15 },
    store: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    hl: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10.5, marginTop: 2 },

    watchRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
        borderRadius: radius, opacity: 0.55,
    },
    watchImg: { width: 56, height: 26, borderRadius: 3, backgroundColor: colors.bgHover },
    watchName: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 13 },
    watchPrice: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    watchStore: { color: colors.textMuted, opacity: 0.7 },
})
