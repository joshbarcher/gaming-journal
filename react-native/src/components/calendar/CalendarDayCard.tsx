import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import type { DayEntry, ReleaseEntry } from '@/utils/calendarRender'
import { CalendarEntryTile } from './CalendarEntryTile'

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type ListItem = { appid: number; name: string; isRelease: boolean; durationMin: number; isLive: boolean; lastPlayed: boolean }

// Port of CalendarMonth.svelte's isPhone branch (mobile portrait, ≤479px) — a scrollable stack of
// per-day cards instead of a 7-column grid, since a real month grid can't fit legibly at 360px
// wide. primaryPath=header.jpg/fallback=poster.jpg — the OPPOSITE fallback order from
// CalendarGridCell, matching the real component split exactly (not a typo).
export function CalendarDayCard({
    day, dow, isToday, isCurrentTodayCard, entries, releases, mode, apiHost,
}: {
    day:      number
    dow:      number
    isToday:  boolean
    isCurrentTodayCard: boolean
    entries:  DayEntry[]
    releases: ReleaseEntry[]
    mode:     string
    apiHost:  string | undefined
}) {
    const { items, overflow } = useMemo(() => {
        const dayEntries  = mode === 'play'     ? entries  : []
        const dayReleases = mode === 'releases' ? releases : []
        const real       = dayEntries.filter(e => !e.lastPlayed).sort((a, b) => b.durationMin - a.durationMin)
        const historical = dayEntries.filter(e => e.lastPlayed).sort((a, b) => a.name.localeCompare(b.name))
        const all: ListItem[] = [
            ...dayReleases.map(r => ({ appid: r.appid, name: r.name, isRelease: true, durationMin: 0, isLive: false, lastPlayed: false })),
            ...real.map(e => ({ appid: e.appid, name: e.name, isRelease: false, durationMin: e.durationMin, isLive: !!e.isLive, lastPlayed: false })),
            ...historical.map(e => ({ appid: e.appid, name: e.name, isRelease: false, durationMin: e.durationMin, isLive: false, lastPlayed: true })),
        ]
        return { items: all.slice(0, 4), overflow: Math.max(0, all.length - 4) }
    }, [entries, releases, mode])

    const isQuad = items.length >= 3
    // Column count matches the real CSS exactly: 1 item → 1 col wide tile; 2 items → 2 col, still
    // wide aspect; 3-4 items → 2 col, square aspect ("quad").
    const tileStyle = items.length === 1
        ? [styles.entryTile, styles.entryTileWide, styles.entryTileFull]
        : isQuad
        ? [styles.entryTile, styles.entryTileSquare]
        : [styles.entryTile, styles.entryTileWide, styles.entryTileHalf]

    return (
        <View style={[styles.card, isCurrentTodayCard && styles.cardToday]}>
            <View style={styles.header}>
                <Text style={[styles.num, isToday && styles.numToday]}>{isToday ? day : day}</Text>
                <Text style={[styles.dow, isToday && styles.dowToday]}>{DOW_SHORT[dow]}</Text>
                {isToday && <Text style={styles.todayLabel}>Today</Text>}
            </View>
            {items.length > 0 ? (
                <View style={styles.entries}>
                    {items.map((e, i) => (
                        <CalendarEntryTile
                            key={`${e.isRelease ? 'r' : 'g'}-${e.appid}`}
                            appid={e.appid}
                            name={e.name}
                            isRelease={e.isRelease}
                            durationMin={e.durationMin}
                            isLive={e.isLive}
                            lastPlayed={e.lastPlayed}
                            apiHost={apiHost}
                            primaryPath={`/relay/images/steam/games/${e.appid}/header.jpg`}
                            fallbackPath={`/relay/images/steam/games/${e.appid}/poster.jpg`}
                            style={tileStyle}
                            overflow={i === items.length - 1 ? overflow : 0}
                        />
                    ))}
                </View>
            ) : (
                <View style={styles.emptySpace} />
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    card: { borderBottomWidth: 1, borderBottomColor: colors.border },
    cardToday: {},
    header: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 6,
    },
    num: { fontSize: 15, fontWeight: '700', color: colors.textMuted, minWidth: 20, fontFamily: fonts.uiBold },
    numToday: {
        minWidth: 0, width: 24, height: 24, borderRadius: 12,
        backgroundColor: colors.accent, color: colors.bg, textAlign: 'center',
        lineHeight: 24, fontSize: 12,
    },
    dow: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.textMuted, fontFamily: fonts.uiBold },
    dowToday: { color: colors.accent },
    todayLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', color: colors.accent, opacity: 0.75 },
    emptySpace: { height: 18 },
    entries: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 3,
        paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    },
    entryTile:       { minWidth: 0 },
    entryTileWide:   { aspectRatio: 460 / 215 },
    entryTileFull:   { width: '100%' },
    entryTileHalf:   { width: '49%' },
    entryTileSquare: { width: '49%', aspectRatio: 1 },
})
