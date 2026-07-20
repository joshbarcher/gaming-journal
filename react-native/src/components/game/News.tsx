import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import type { RichNewsItem } from '@/api/gamePage'

// Port of News.svelte + NewsCard.svelte (game.css .nws-*). The web shows a full row of the 4 most
// recent thumbnailed cards, each linking to an in-app article page, with an "All {n} ›" link to the
// full News list route. This replaces the old external-link-only headline dropdown: cards now push
// to /game/{appid}/news/{gid} (the in-app reader) instead of Linking.openURL.
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export function formatNewsDate(ts?: number): string {
    return ts ? dateFmt.format(new Date(ts * 1000)) : ''
}

// Steam news thumbnails are absolute CDN URLs; host-relative paths (rare) get the apiHost prefix.
function newsImageUri(src: string | null | undefined, apiHost: string | undefined): string | null {
    if (!src) return null
    if (src.startsWith('http')) return src
    return apiHost ? `${apiHost}${src}` : null
}

export function NewsCard({ item, appid, apiHost, width }: {
    item: RichNewsItem
    appid: number
    apiHost: string | undefined
    width?: DimensionValue
}) {
    const uri = newsImageUri(item.previewImage, apiHost)
    return (
        <Pressable
            style={StyleSheet.flatten([styles.card, width != null && { width }])}
            onPress={() => router.push(`/game/${appid}/news/${encodeURIComponent(item.gid ?? '')}` as never)}
        >
            <View style={styles.thumb}>
                {uri
                    ? <Image source={{ uri }} style={styles.thumbImg} contentFit="cover" transition={150} />
                    : <Text style={styles.thumbFallback} numberOfLines={2}>{item.feedlabel}</Text>}
            </View>
            <View style={styles.body}>
                {!!item.feedlabel && <Text style={styles.feed} numberOfLines={1}>{item.feedlabel}</Text>}
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {!!item.excerpt && <Text style={styles.excerpt} numberOfLines={2}>{item.excerpt}</Text>}
                <Text style={styles.date}>{formatNewsDate(item.date)}</Text>
            </View>
        </Pressable>
    )
}

export function News({ appid, items, apiHost }: { appid: number; items: RichNewsItem[]; apiHost: string | undefined }) {
    // Measure the grid width so we can reproduce the web section's "one deliberate full row" of the
    // most recent cards. Web .nws-grid--recent is repeat(4,1fr) on desktop, dropping to 2 cols ≤1180px
    // and 1 col ≤560px (game.css:2983-2985); tablet-landscape lands on the 4-across single row.
    const [gridW, setGridW] = useState(0)
    if (!items.length) return null
    const top = items.slice(0, 4)
    const GAP = 16 // web .nws-grid gap
    const cols = gridW >= 720 ? 4 : gridW >= 420 ? 2 : 1
    const cardW = gridW > 0 ? Math.floor((gridW - GAP * (cols - 1)) / cols) : undefined
    return (
        <View style={styles.section}>
            <View style={styles.titleRow}>
                <Text style={styles.sectionTitle}>News</Text>
                <Pressable onPress={() => router.push(`/game/${appid}/news` as never)} hitSlop={8}>
                    <Text style={styles.allLink}>All {items.length} ›</Text>
                </Pressable>
            </View>
            <View style={[styles.grid, { columnGap: GAP }]} onLayout={e => setGridW(e.nativeEvent.layout.width)}>
                {cardW != null && top.map((item, i) => (
                    <NewsCard key={item.gid ?? i} item={item} appid={appid} apiHost={apiHost} width={cardW} />
                ))}
            </View>
            <Pressable onPress={() => router.push(`/game/${appid}/news` as never)} hitSlop={8} style={styles.moreLink}>
                <Text style={styles.moreText}>All news →</Text>
            </Pressable>
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    sectionTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    allLink: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    // Row of fixed-width cards (widths computed from the measured grid) — mirrors the CSS-grid
    // repeat(N,1fr) columns; columnGap is applied inline, rowGap covers the 2-col wrap case.
    grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: 10, overflow: 'hidden',
    },
    thumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' },
    thumbImg: { width: '100%', height: '100%' },
    thumbFallback: {
        color: colors.textMuted, fontFamily: fonts.title, fontSize: 12, letterSpacing: 1,
        textTransform: 'uppercase', textAlign: 'center', paddingHorizontal: spacing.md,
    },
    // Web .nws-body: 11px top / 13px sides+bottom, flex:1 so the date can sit at the card bottom.
    body: { paddingTop: 11, paddingHorizontal: 13, paddingBottom: 13, gap: 6, flex: 1 },
    feed: { color: colors.accent, fontFamily: fonts.ui, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14, lineHeight: 19 },
    excerpt: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
    date: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginTop: 'auto', paddingTop: 2 },
    // Web .nxm-more "All news →" link below the row.
    moreLink: { marginTop: spacing.lg, alignSelf: 'flex-start' },
    moreText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12 },
})
