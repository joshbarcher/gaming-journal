import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link, router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getAccount } from '@/api/account'
import { getFlags } from '@/api/flags'
import { getSettings } from '@/api/settings'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { fmtDate, fmtDayLabel, fmtHrs, fmtMins } from '@/utils/accountRender'
import { localDateStr } from '@/utils/calendarRender'
import { makeShouldShow } from '@/utils/gameFilter'
import type { AccountGame, AccountGameSession } from 'gaming-journal-contracts/account'

// Port of Account.svelte (account/account.md) — Steam profile hero, 6-tile stats strip, Recently
// Played (horizontal row), Most Played (ranked bar list), Session History (grouped by local
// calendar day via the same `localDateStr()` already ported for Calendar, reused rather than a
// 3rd copy). `recentlyPlayed`/`mostPlayed`/sessions are all filtered through the same
// `makeShouldShow` predicate the web's `loadGameFilter()` builds — factored into
// `utils/gameFilter.ts` this item since Account is the second screen needing it standalone.
export default function AccountScreen() {
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const accountQuery = useQuery({ queryKey: ['account'], queryFn: getAccount })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })

    const loading = accountQuery.isLoading || flagsQuery.isLoading || settingsQuery.isLoading

    const { recentlyPlayed, mostPlayed, sessionsByDay, liveSessions } = useMemo(() => {
        const data = accountQuery.data
        if (!data || !flagsQuery.data || !settingsQuery.data) {
            return { recentlyPlayed: [] as AccountGame[], mostPlayed: [] as AccountGame[], sessionsByDay: [], liveSessions: [] as (AccountGameSession & { name: string })[] }
        }
        const shouldShow = makeShouldShow(flagsQuery.data, settingsQuery.data)
        const recentlyPlayed = (data.recentlyPlayed ?? []).filter(g => shouldShow(g.appid))
        const mostPlayed = (data.mostPlayed ?? []).filter(g => shouldShow(g.appid))

        const entries = Object.entries(data.sessions ?? {}).filter(([appid]) => shouldShow(appid))
        const flat: Array<AccountGameSession & { name: string }> = []
        for (const [, game] of entries) for (const s of game.sessions ?? []) flat.push({ name: game.name, ...s })
        flat.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

        const byDay = new Map<string, Array<AccountGameSession & { name: string }>>()
        for (const s of flat) {
            const day = localDateStr(s.startedAt)
            if (!byDay.has(day)) byDay.set(day, [])
            byDay.get(day)!.push(s)
        }
        const sessionsByDay = [...byDay.entries()].map(([day, ss]) => ({ day, label: fmtDayLabel(day), sessions: ss }))
        const liveSessions = flat.filter(s => s.endedAt === null)

        return { recentlyPlayed, mostPlayed, sessionsByDay, liveSessions }
    }, [accountQuery.data, flagsQuery.data, settingsQuery.data])

    // Live-ticking duration for any session still in progress — recomputed every 30s, same
    // interval as the web's `tickLive()`. No now-playing poll needed here: elapsed time is purely
    // derived from `Date.now() - startedAt` for sessions with `endedAt === null`. The state value
    // itself is unused beyond forcing this re-render — `liveDuration()` below recomputes fresh
    // from `Date.now()` every render regardless.
    const [, forceTick] = useState(0)
    useEffect(() => {
        if (liveSessions.length === 0) return
        const t = setInterval(() => forceTick(x => x + 1), 30_000)
        return () => clearInterval(t)
    }, [liveSessions.length])

    function liveDuration(startedAt: string): string {
        const mins = Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000))
        return fmtHrs(mins)
    }

    if (loading) {
        return <View style={styles.container}><ActivityIndicator color={colors.accent} /></View>
    }
    if (accountQuery.isError || !accountQuery.data) {
        return <View style={styles.container}><Text style={styles.errorText}>Failed to load account.</Text></View>
    }

    const { profile, steam, stats } = accountQuery.data
    const maxMin = mostPlayed[0]?.playtimeMin ?? 1

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.hero}>
                {!!profile.avatar && <Image source={{ uri: profile.avatar }} style={styles.avatar} contentFit="cover" />}
                <View style={styles.heroInfo}>
                    <Text style={styles.name}>{profile.name}</Text>
                    {!!profile.realName && <Text style={styles.realName}>{profile.realName}</Text>}
                    <View style={styles.heroMeta}>
                        {steam?.level != null && <View style={styles.levelBadge}><Text style={styles.levelBadgeText}>Lvl {steam.level}</Text></View>}
                        {steam?.xp != null && <Text style={styles.xp}>{steam.xp.toLocaleString()} XP</Text>}
                    </View>
                    <Text style={styles.heroSub}>
                        Member since {profile.memberSince ?? '?'} · Last seen {profile.lastLogoff ? fmtDate(profile.lastLogoff) : 'Unknown'}
                    </Text>
                    {!!profile.profileUrl && (
                        <Pressable onPress={() => Linking.openURL(profile.profileUrl!)}>
                            <Text style={styles.steamLink}>View Steam Profile →</Text>
                        </Pressable>
                    )}
                </View>
            </View>

            <View style={styles.statsStrip}>
                {[
                    { label: 'Hours Played', value: stats?.totalHoursPlayed?.toLocaleString() ?? '—' },
                    { label: 'Games Played', value: stats?.gamesPlayed?.toLocaleString() ?? '—' },
                    { label: 'Achievements', value: stats?.achievementsUnlocked?.toLocaleString() ?? '—' },
                    { label: 'Reviews', value: stats?.reviewsWritten?.toLocaleString() ?? '—' },
                    { label: 'Library', value: stats?.totalGames?.toLocaleString() ?? '—' },
                    { label: 'Wishlist', value: stats?.wishlistCount?.toLocaleString() ?? '—' },
                ].map(tile => (
                    <View key={tile.label} style={styles.statTile}>
                        <Text style={styles.statValue}>{tile.value}</Text>
                        <Text style={styles.statLabel}>{tile.label}</Text>
                    </View>
                ))}
            </View>

            {recentlyPlayed.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Recently Played</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardRow}>
                        {recentlyPlayed.map(g => {
                            const sub = g.playtime2weeks ? `${fmtMins(g.playtime2weeks)} this week` : g.lastPlayedAt ? fmtDate(g.lastPlayedAt) : ''
                            return (
                                <Link key={g.appid} href={`/game/${g.appid}` as never} asChild>
                                    <Pressable style={styles.gameCard}>
                                        {!!apiHost && (
                                            <Image source={{ uri: `${apiHost}/relay/images/steam/games/${g.appid}/header.jpg` }} style={styles.gameCardImg} contentFit="cover" />
                                        )}
                                        <Text style={styles.gameCardName} numberOfLines={1}>{g.name}</Text>
                                        <Text style={styles.gameCardSub}>{sub}</Text>
                                        <Text style={styles.gameCardHrs}>{fmtHrs(g.playtimeMin)}</Text>
                                    </Pressable>
                                </Link>
                            )
                        })}
                    </ScrollView>
                </View>
            )}

            {mostPlayed.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Most Played</Text>
                    <View style={styles.mostPlayed}>
                        {mostPlayed.map((g, i) => (
                            <Pressable key={g.appid} style={styles.mpRow} onPress={() => router.push(`/game/${g.appid}` as never)}>
                                <Text style={styles.mpRank}>{i + 1}</Text>
                                {!!apiHost && (
                                    <Image source={{ uri: `${apiHost}/relay/images/steam/games/${g.appid}/header.jpg` }} style={styles.mpImg} contentFit="cover" />
                                )}
                                <Text style={styles.mpName} numberOfLines={1}>{g.name}</Text>
                                <View style={styles.mpBarWrap}>
                                    <View style={[styles.mpBar, { width: `${Math.round(((g.playtimeMin ?? 0) / maxMin) * 100)}%` }]} />
                                </View>
                                <Text style={styles.mpHrs}>{fmtHrs(g.playtimeMin)}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            )}

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Session History</Text>
                {sessionsByDay.length === 0 ? (
                    <Text style={styles.empty}>No sessions recorded yet. Session tracking builds over time.</Text>
                ) : (
                    sessionsByDay.map(({ day, label, sessions: ss }) => (
                        <View key={day} style={styles.sessionDay}>
                            <Text style={styles.sessionDate}>{label}</Text>
                            {ss.map((s, i) => s.endedAt === null ? (
                                <View key={i} style={[styles.sessionRow, styles.sessionRowLive]}>
                                    <Text style={styles.sessionName} numberOfLines={1}>{s.name}</Text>
                                    <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveBadgeText}>Now Playing</Text></View>
                                    <Text style={styles.sessionDur}>{liveDuration(s.startedAt)}</Text>
                                </View>
                            ) : (
                                <View key={i} style={styles.sessionRow}>
                                    <Text style={styles.sessionName} numberOfLines={1}>{s.name}</Text>
                                    <Text style={styles.sessionDur}>{fmtHrs(s.durationMin)}</Text>
                                </View>
                            ))}
                        </View>
                    ))
                )}
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
    errorText: { color: colors.text, fontFamily: fonts.ui, textAlign: 'center', margin: spacing.lg },
    hero: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    avatar: { width: 72, height: 72, borderRadius: radius, backgroundColor: colors.bgHover },
    heroInfo: { flex: 1, gap: 4 },
    name: { color: colors.text, fontFamily: fonts.title, fontSize: 20 },
    realName: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    heroMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
    levelBadge: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 1 },
    levelBadgeText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11 },
    xp: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    heroSub: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginTop: 2 },
    steamLink: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12, marginTop: 4 },
    statsStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    statTile: { flexBasis: '31%', flexGrow: 1, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, alignItems: 'center', gap: 2 },
    statValue: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    statLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
    section: { gap: spacing.sm },
    sectionTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 15 },
    cardRow: { gap: spacing.sm },
    gameCard: { width: 160, gap: 4 },
    gameCardImg: { width: '100%', aspectRatio: 460 / 215, borderRadius: radius, backgroundColor: colors.bgHover },
    gameCardName: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    gameCardSub: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    gameCardHrs: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11 },
    mostPlayed: { gap: 4 },
    mpRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
    mpRank: { width: 18, color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textAlign: 'center' },
    mpImg: { width: 48, height: 22, borderRadius: 3, backgroundColor: colors.bgHover },
    mpName: { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    mpBarWrap: { width: 80, height: 5, borderRadius: 3, backgroundColor: colors.bgHover, overflow: 'hidden' },
    mpBar: { height: '100%', backgroundColor: colors.progress, borderRadius: 3 },
    mpHrs: { width: 48, color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textAlign: 'right' },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, fontStyle: 'italic' },
    sessionDay: { gap: 4, marginBottom: spacing.sm },
    sessionDate: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    sessionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
    sessionRowLive: {},
    sessionName: { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#7edb8a' },
    liveBadgeText: { color: '#7edb8a', fontFamily: fonts.uiBold, fontSize: 10 },
    sessionDur: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 12 },
})
