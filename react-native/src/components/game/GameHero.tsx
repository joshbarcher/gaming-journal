import { router } from 'expo-router'
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
export function GameHero({
    game, communityReviews, protonTier, apiHost,
}: {
    game: GameDetail
    communityReviews: CommunityReviews | null | undefined
    protonTier: ProtonDbRaw | null | undefined
    apiHost: string | undefined
}) {
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

    return (
        <View style={styles.hero}>
            {frames.length > 0 && <HeroCrossfade frames={frames} intervalMs={6000} fadeMs={1500} />}
            <View style={styles.scrim} />
            <View style={styles.content}>
                <Pressable onPress={() => router.push('/' as never)}>
                    <Text style={styles.breadcrumb}>Home / <Text style={styles.breadcrumbCurrent}>{game.name}</Text></Text>
                </Pressable>
                <Text style={styles.title} numberOfLines={2}>{game.name}</Text>

                <View style={styles.chipsRow}>
                    <ScoreChip label="Steam" score={steamRatio} display={steamRatio != null ? `${Math.round(steamRatio)}%` : ''} />
                    <ScoreChip label="Metacritic" score={mcScore} display={mcScore != null ? String(mcScore) : ''} />
                    <ScoreChip label="OpenCritic" score={null} display="" />
                    {protonTier?.tier && (
                        <Pressable
                            style={styles.protonBadge}
                            onPress={() => Linking.openURL(`https://www.protondb.com/app/${game.appid}`)}
                        >
                            <Text style={styles.protonBadgeText}>Proton: {protonTier.tier}</Text>
                        </Pressable>
                    )}
                </View>

                <View style={styles.statsPanel}>
                    <StatRow label="Played" value={playerHours > 0 ? fmtHours(playerHours) : 'Not played'} />
                    {hltb?.matched && hltb.gameplayMain != null && <StatRow label="Main Story" value={fmtHours(hltb.gameplayMain)} />}
                    {hltb?.matched && hltb.gameplayMainExtra != null && <StatRow label="Main + Extras" value={fmtHours(hltb.gameplayMainExtra)} />}
                    {hltb?.matched && hltb.gameplayCompletionist != null && <StatRow label="Completionist" value={fmtHours(hltb.gameplayCompletionist)} />}
                    {itad?.bestPrice ? (
                        <StatRow
                            label="Best Price"
                            value={`$${itad.bestPrice.price?.toFixed(2)} · ${itad.bestPrice.store}${itad.bestPrice.cut ? ` -${itad.bestPrice.cut}%` : ''}`}
                        />
                    ) : store?.isFree ? (
                        <StatRow label="Best Price" value="Free to Play" />
                    ) : store?.price?.final_formatted ? (
                        <StatRow label="Best Price" value={`${store.price.final_formatted} · Steam`} />
                    ) : null}
                    {itad?.historicalLow && (
                        <StatRow
                            label="All-Time Low"
                            value={`$${itad.historicalLow.price?.toFixed(2)} · ${itad.historicalLow.store} (${itad.historicalLow.date?.slice(0, 4)})`}
                        />
                    )}
                    {store?.releaseDate && <StatRow label={releaseLabel} value={store.releaseDate} />}
                    {developer && <StatRow label="Developer" value={developer} />}
                    {publisher && <StatRow label="Publisher" value={publisher} />}
                    {platStr && <StatRow label="Platforms" value={platStr} />}
                    <Pressable onPress={() => Linking.openURL(`https://store.steampowered.com/app/${game.appid}`)}>
                        <StatRow label="Steam ID" value={`${game.appid} ↗`} />
                    </Pressable>
                </View>

                {badges.length > 0 && (
                    <View style={styles.badgeRow}>
                        {badges.map(b => <Text key={b} style={styles.badge}>{b}</Text>)}
                    </View>
                )}

                <View style={styles.actionsRow}>
                    <Pressable style={styles.actionBtn} onPress={() => router.push(`/journal/${game.appid}` as never)}>
                        <Text style={styles.actionBtnText}>Open Journal</Text>
                    </Pressable>
                    <Pressable style={styles.actionBtn} onPress={() => router.push(`/community/${game.appid}` as never)}>
                        <Text style={styles.actionBtnText}>Community</Text>
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

function ScoreChip({ label, score, display }: { label: string; score: number | null; display: string }) {
    const c = scoreColor(score)
    return (
        <View style={[styles.chip, c && { backgroundColor: c.bg }]}>
            <Text style={styles.chipLabel}>{label}</Text>
            <Text style={[styles.chipValue, { color: c?.clr ?? colors.textMuted }]}>{display || '—'}</Text>
        </View>
    )
}

function StatRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.statRow}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    hero: { minHeight: 260, backgroundColor: colors.bgRaised, overflow: 'hidden' },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(13,11,9,0.45)' },
    content: { padding: spacing.md, gap: spacing.sm },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 11 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    title: { color: '#fff', fontFamily: fonts.title, fontSize: 22, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
    chipLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, textTransform: 'uppercase' },
    chipValue: { fontFamily: fonts.uiBold, fontSize: 12 },
    protonBadge: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, paddingHorizontal: spacing.sm, paddingVertical: 4 },
    protonBadgeText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'capitalize' },
    statsPanel: { backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 6, padding: spacing.sm, gap: 4, maxWidth: 420 },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
    statLabel: { color: 'rgba(255,255,255,0.55)', fontFamily: fonts.ui, fontSize: 11 },
    statValue: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 11, flexShrink: 1, textAlign: 'right' },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    badge: {
        color: 'rgba(255,255,255,0.7)', fontFamily: fonts.ui, fontSize: 10,
        backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
    },
    actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    actionBtn: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct, borderRadius: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    actionBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
})
