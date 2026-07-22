import { Feather } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { HeroCrossfade } from '@/components/shared/HeroCrossfade'
import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtHours, scoreColor } from '@/utils/gameRender'
import type { CommunityReviews } from 'gaming-journal-contracts/communityReviews'
import type { GameDetail } from 'gaming-journal-contracts/gameDetail'
import type { ProtonDbRaw } from 'gaming-journal-contracts/protondb'

// Port of GameHero.svelte. Background slideshow reuses the shared HeroCrossfade component in its
// "precomputed frames" mode (same one built for the Franchise detail hero) — game.media.screenshots
// is already available from Phase 1, no per-appid probing needed. Interval/fade match GameHero's
// own constants (6000ms/1500ms), NOT Favorites' (14000ms/1500ms) or Franchise's (6000ms/1800ms).
// Deliberately NOT ported: the 20% chance "Ken Burns" background-position pan over 10s — same
// category of deliberate cosmetic simplification as Favorites'/Franchise's hero (crossfade itself,
// the actual documented behavior, is exact; the pan is decoration on top).
// Also NOT ported: the update-badge phase-2-loading micro-animation (1200ms hold + 400ms fade) —
// each RN section already shows its own inline loading state via useQuery, so a second floating
// "still loading" indicator duplicates that signal rather than adding real information.
//
// 2026-07-18 parity rework: the hero now mirrors the web's DESKTOP two-column layout (left column
// = logo/title/desc/genre pills, right column = the bounded `.game-data-panel`). The score chips
// (Steam / OpenCritic / Metacritic), all stat rows, and the Open Journal / Community buttons live
// INSIDE that one card — matching GameHero.svelte:185-282 — rather than the previous "chips floating
// in a bare row over the raw art." The ProtonDB tier is rendered as the web's metallic award-badge
// block (award icon + TIER + LINUX / PROTON), floated to the panel's left like `.game-panel-badges`.
// Layout is width-responsive (measured via onLayout): wide → the two-column desktop hero; narrow →
// the web's single-column collapse (panel full-width, proton badge stacked above it).

// ProtonDB tier metallic palette — solid approximations of the web's `.proton-badge--{tier}`
// gradients (game.css:2151-2157), which RN can't render without a gradient dependency.
const PROTON_TIERS: Record<string, { clr: string; bg: string; border: string }> = {
    native:   { clr: '#7dda84',              bg: 'rgba(28,52,30,0.82)', border: 'rgba(125,218,132,0.30)' },
    platinum: { clr: '#8aaac8',              bg: 'rgba(34,52,80,0.82)', border: 'rgba(130,165,200,0.24)' },
    gold:     { clr: '#d4a843',              bg: 'rgba(58,40,10,0.82)', border: 'rgba(200,155,45,0.35)' },
    silver:   { clr: '#b0bcc8',              bg: 'rgba(44,50,56,0.82)', border: 'rgba(155,170,185,0.28)' },
    bronze:   { clr: '#c8904a',              bg: 'rgba(54,32,12,0.82)', border: 'rgba(185,125,55,0.30)' },
    borked:   { clr: '#d46060',              bg: 'rgba(58,16,16,0.82)', border: 'rgba(200,70,70,0.30)' },
    pending:  { clr: 'rgba(200,200,200,0.55)', bg: 'rgba(10,9,8,0.82)', border: 'rgba(255,255,255,0.14)' },
}

export function GameHero({
    game, communityReviews, protonTier, apiHost,
}: {
    game: GameDetail
    communityReviews: CommunityReviews | null | undefined
    protonTier: ProtonDbRaw | null | undefined
    apiHost: string | undefined
}) {
    const [heroWidth, setHeroWidth] = useState(0)
    const wide = heroWidth >= 700

    const store = game.store
    const screenshots = game.media?.screenshots ?? []
    const frames = apiHost
        ? (screenshots.length > 0 ? screenshots : [game.media?.background, game.media?.header].filter((s): s is string => !!s))
            .map(p => `${apiHost}${p}`)
        : []

    const steamRatio = communityReviews?.summary?.ratio ?? null
    const mc = store?.metacritic
    const mcScore = typeof mc === 'number' ? mc : (mc?.score ?? null)

    const playerHours = (game.playtimeMinutes ?? 0) / 60
    const hltb = game.hltb
    const itad = game.itad

    const genres = store?.genres ?? []
    const catWhitelist = ['Single-player', 'Multi-player', 'Co-op', 'Online Co-op', 'Steam Achievements', 'Steam Cloud', 'Full controller support']
    const cats = (store?.categories ?? []).filter(c => catWhitelist.includes(c))
    const badges = [...genres, ...cats].slice(0, 7)

    const releaseLabel = (store?.categories ?? []).includes('Early Access') ? 'Early Access Since' : 'Released'
    const platStr = [
        store?.platforms?.windows && 'Windows',
        store?.platforms?.mac && 'macOS',
        store?.platforms?.linux && 'Linux',
    ].filter(Boolean).join(' · ')

    const developer = store?.developers?.[0]
    const publisher = store?.publishers?.[0] && store.publishers[0] !== developer ? store.publishers[0] : null

    // Hero left column (GameHero.svelte): the logo image over a description paragraph, above the
    // title. media.logo is a host-relative relay path (absolute URLs pass through unchanged).
    const logo = game.media?.logo
    const logoUri = logo ? (logo.startsWith('http') ? logo : (apiHost ? `${apiHost}${logo}` : undefined)) : undefined
    // Entities in the store description are now decoded server-side (games.service mergeStore →
    // shared/decode-entities), so this plain <Text> can render it as-is. Decoding again here would
    // double-decode intentionally double-escaped content, so we don't.
    const desc = store?.description ?? ''

    // ── Data-panel rows (built once, mirrors GameHero.svelte's ordered blocks) ──
    const hltbRows: { label: string; value: string }[] = []
    if (hltb?.matched) {
        if (hltb.gameplayMain != null) hltbRows.push({ label: 'Main Story', value: fmtHours(hltb.gameplayMain) })
        if (hltb.gameplayMainExtra != null) hltbRows.push({ label: 'Main + Extras', value: fmtHours(hltb.gameplayMainExtra) })
        if (hltb.gameplayCompletionist != null) hltbRows.push({ label: 'Completionist', value: fmtHours(hltb.gameplayCompletionist) })
    }

    // Prices block (GdpPrices.svelte): a leading divider, then Best Price / Price, then All-Time Low.
    let priceRow: { label: string; value: string; cut?: string } | null = null
    if (itad?.bestPrice) {
        priceRow = {
            label: 'Best Price',
            value: `$${itad.bestPrice.price?.toFixed(2)} · ${itad.bestPrice.store}`,
            cut: itad.bestPrice.cut ? ` -${itad.bestPrice.cut}%` : undefined,
        }
    } else if (store?.isFree) {
        priceRow = { label: 'Price', value: 'Free to Play' }
    } else if (store?.price?.final_formatted) {
        priceRow = { label: 'Price', value: `${store.price.final_formatted} · Steam` }
    }
    const lowRow = itad?.historicalLow
        ? { label: 'All-Time Low', value: `$${itad.historicalLow.price?.toFixed(2)} · ${itad.historicalLow.store} (${itad.historicalLow.date?.slice(0, 4)})` }
        : null

    const releaseRows: { label: string; value: string }[] = []
    if (store?.releaseDate) releaseRows.push({ label: releaseLabel, value: store.releaseDate })
    if (developer) releaseRows.push({ label: 'Developer', value: developer })
    if (publisher) releaseRows.push({ label: 'Publisher', value: publisher })
    if (platStr) releaseRows.push({ label: 'Platforms', value: platStr })

    const tierRaw = protonTier?.tier ?? null
    const protonBadge = tierRaw ? (
        <ProtonBadge tier={tierRaw} appid={game.appid} />
    ) : null

    const dataPanel = (
        <View style={[styles.dataPanel, wide ? styles.dataPanelWide : styles.dataPanelNarrow]}>
            {/* Score chips row — bounded inside the card, with a bottom divider (gdp-score-row) */}
            <View style={styles.scoreRow}>
                <ScoreChip source="Steam" score={steamRatio} display={steamRatio != null ? `${Math.round(steamRatio)}%` : ''} />
                <ScoreChip source="OpenCritic" score={null} display="" />
                <ScoreChip source="Metacritic" score={mcScore} display={mcScore != null ? String(mcScore) : ''} />
            </View>

            <StatRow label="Played" value={playerHours > 0 ? fmtHours(playerHours) : 'Not played'} />

            {hltbRows.length > 0 && <View style={styles.divider} />}
            {hltbRows.map(r => <StatRow key={r.label} label={r.label} value={r.value} />)}

            {(priceRow || lowRow) && <View style={styles.divider} />}
            {priceRow && <StatRow label={priceRow.label} value={priceRow.value} cut={priceRow.cut} />}
            {lowRow && <StatRow label={lowRow.label} value={lowRow.value} />}

            {releaseRows.length > 0 && <View style={styles.divider} />}
            {releaseRows.map(r => <StatRow key={r.label} label={r.label} value={r.value} />)}

            <View style={styles.divider} />
            <Pressable onPress={() => Linking.openURL(`https://store.steampowered.com/app/${game.appid}`)}>
                <StatRow label="Steam ID" value={`${game.appid} ↗`} steam />
            </Pressable>

            <View style={styles.panelBtns}>
                <Pressable style={[styles.panelBtn, styles.journalBtn]} onPress={() => router.push(`/journal/${game.appid}` as never)}>
                    <Feather name="file-text" size={13} color={colors.accent} />
                    <Text style={[styles.panelBtnText, { color: colors.accent }]}>Open Journal</Text>
                </Pressable>
                <Pressable style={[styles.panelBtn, styles.communityBtn]} onPress={() => router.push(`/community/${game.appid}` as never)}>
                    <Feather name="message-square" size={13} color="#5b9bd5" />
                    <Text style={[styles.panelBtnText, { color: '#5b9bd5' }]}>Community</Text>
                </Pressable>
            </View>
        </View>
    )

    return (
        <View style={styles.hero} onLayout={e => setHeroWidth(e.nativeEvent.layout.width)}>
            {frames.length > 0 && <HeroCrossfade frames={frames} intervalMs={6000} fadeMs={1500} />}
            {/* web `.game-hero::before`: horizontal gradient, DARKEST on the left where the title/desc/
                badges sit (0.78 → 0.60 → 0.25). A flat 0.45 scrim let the bright art wash out the
                foreground; this darker left column makes the text/badges pop like web. */}
            <LinearGradient
                colors={['rgba(13,11,9,0.80)', 'rgba(13,11,9,0.62)', 'rgba(13,11,9,0.28)']}
                locations={[0, 0.42, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
            />
            {/* bottom-up darkening for depth (web's second `::before` layer) */}
            <LinearGradient
                colors={['transparent', 'rgba(13,11,9,0.35)']}
                locations={[0.55, 1]}
                style={StyleSheet.absoluteFill}
            />
            <View style={styles.content}>
                <Pressable onPress={() => router.push('/' as never)}>
                    <Text style={styles.breadcrumb}>Home / <Text style={styles.breadcrumbCurrent}>{game.name}</Text></Text>
                </Pressable>

                <View style={[styles.body, wide ? styles.bodyWide : styles.bodyNarrow]}>
                    <View style={[styles.left, wide && styles.leftWide]}>
                        {logoUri && <Image source={{ uri: logoUri }} style={styles.logo} contentFit="contain" transition={150} />}
                        <Text style={styles.title} numberOfLines={2}>{game.name}</Text>
                        {!!desc && <Text style={styles.desc} numberOfLines={4}>{desc}</Text>}
                        {badges.length > 0 && (
                            <View style={styles.badgeRow}>
                                {badges.map(b => <Text key={b} style={styles.badge}>{b}</Text>)}
                            </View>
                        )}
                        {/* Narrow: proton badge stacks above the panel (web's hero-mobile-score-strip) */}
                        {!wide && protonBadge && <View style={styles.protonStripNarrow}>{protonBadge}</View>}
                    </View>

                    {wide ? (
                        <View style={styles.right}>
                            {protonBadge}
                            {dataPanel}
                        </View>
                    ) : (
                        dataPanel
                    )}
                </View>
            </View>
        </View>
    )
}

// ProtonDB metallic award badge — mirrors the web `.proton-badge` block (game.css:2119-2199):
// tier name on top, award icon in the middle, "LINUX / PROTON" beneath.
function ProtonBadge({ tier, appid }: { tier: string; appid: number }) {
    const t = PROTON_TIERS[tier.toLowerCase()] ?? PROTON_TIERS.pending
    return (
        <Pressable
            style={[styles.protonBadge, { backgroundColor: t.bg, borderColor: t.border }]}
            onPress={() => Linking.openURL(`https://www.protondb.com/app/${appid}`)}
        >
            <Text style={[styles.protonTier, { color: t.clr }]} numberOfLines={1}>{tier.toUpperCase()}</Text>
            <Feather name="award" size={26} color={t.clr} />
            <Text style={styles.protonSub}>LINUX / PROTON</Text>
        </Pressable>
    )
}

function ScoreChip({ source, score, display }: { source: string; score: number | null; display: string }) {
    const c = scoreColor(score)
    if (c == null) {
        return (
            <View style={[styles.chip, styles.chipMissing]}>
                <Text style={[styles.chipSource, { color: 'rgba(255,255,255,0.28)' }]}>{source}</Text>
                <Text style={[styles.chipValue, { color: 'rgba(255,255,255,0.28)' }]}>—</Text>
            </View>
        )
    }
    return (
        <View style={[styles.chip, { borderColor: c.clr, backgroundColor: c.bg }]}>
            <Text style={[styles.chipSource, { color: c.clr }]}>{source}</Text>
            <Text style={[styles.chipValue, { color: c.clr }]}>{display || '—'}</Text>
        </View>
    )
}

function StatRow({ label, value, cut, steam }: { label: string; value: string; cut?: string; steam?: boolean }) {
    return (
        <View style={styles.statRow}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={[styles.statValue, steam && { color: colors.accent }]} numberOfLines={1}>
                {value}{!!cut && <Text style={styles.statCut}>{cut}</Text>}
            </Text>
        </View>
    )
}

const styles = StyleSheet.create({
    hero: { minHeight: 340, backgroundColor: colors.bgRaised, overflow: 'hidden' },
    content: { padding: spacing.md, gap: spacing.sm },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 11 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },

    body: { gap: spacing.md },
    bodyWide: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xl },
    bodyNarrow: { flexDirection: 'column' },

    left: { gap: spacing.md },
    leftWide: { flex: 1, minWidth: 0 },
    logo: { width: 220, height: 66, alignSelf: 'flex-start' },
    title: { color: '#fff', fontFamily: fonts.title, fontSize: 24, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
    desc: { color: 'rgba(237,233,223,0.82)', fontFamily: fonts.ui, fontSize: 13, lineHeight: 20, maxWidth: 560, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    // Slightly brighter than web's 0.55/0.05/0.14 so the pills read clearly against the hero art
    // (native has no backdrop-blur to lift them the way web's blurred scrim does).
    badge: {
        color: 'rgba(237,233,223,0.72)', fontFamily: fonts.ui, fontSize: 11,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
        backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
    },
    protonStripNarrow: { flexDirection: 'row', marginTop: 2 },

    right: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },

    // The one bounded card — dark translucent, rounded, holds chips + stats + buttons.
    dataPanel: {
        // Web blurs the art behind this 72%-opaque card into a smooth base; RN has no backdrop-filter,
        // so raise to 0.90 to keep the stat text crisp instead of washed out by the sharp screenshot.
        backgroundColor: 'rgba(8,7,6,0.90)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.09)',
        borderRadius: 4,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    dataPanelWide: { width: 300 },
    dataPanelNarrow: { width: '100%', maxWidth: 420 },

    scoreRow: {
        flexDirection: 'row',
        gap: 6,
        paddingBottom: 10,
        marginBottom: 4,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.07)',
    },
    chip: {
        flex: 1,
        alignItems: 'center',
        gap: 3,
        paddingTop: 7,
        paddingBottom: 6,
        paddingHorizontal: 4,
        borderRadius: 5,
        borderWidth: 1,
    },
    chipMissing: { opacity: 0.4, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'transparent' },
    chipSource: { fontFamily: fonts.uiBold, fontSize: 8, letterSpacing: 0.7, textTransform: 'uppercase' },
    chipValue: { fontFamily: fonts.uiBold, fontSize: 17, lineHeight: 18 },

    statRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 3 },
    statLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, flexShrink: 0 },
    statValue: { color: colors.text, fontFamily: fonts.ui, fontSize: 11.5, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
    statCut: { color: '#5cba5c', fontFamily: fonts.uiBold, fontSize: 10 },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 6 },

    panelBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: 10 },
    panelBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: 10,
        paddingHorizontal: spacing.md,
        borderWidth: 1,
        borderRadius: 4,
    },
    journalBtn: { backgroundColor: 'rgba(201,168,76,0.08)', borderColor: 'rgba(201,168,76,0.3)' },
    communityBtn: { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.32)' },
    panelBtnText: { fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },

    // ProtonDB metallic award badge (square, floats to the panel's left on wide).
    protonBadge: {
        width: 76,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 6,
        borderWidth: 1,
    },
    protonTier: { fontFamily: fonts.uiBold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center' },
    protonSub: { color: 'rgba(255,255,255,0.72)', fontFamily: fonts.uiBold, fontSize: 8, letterSpacing: 0.3, textTransform: 'uppercase', textAlign: 'center' },
})
