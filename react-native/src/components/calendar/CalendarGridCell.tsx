import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors, fonts } from '@/theme/tokens'
import type { DayEntry, ReleaseEntry } from '@/utils/calendarRender'
import { CalendarEntryTile } from './CalendarEntryTile'

type CellEntry = { appid: number; name: string; isRelease: boolean; durationMin: number; isLive: boolean; lastPlayed: boolean }

// Port of CalendarCell.svelte (desktop/tablet month-grid cell, ≥480px). primaryPath=poster.jpg,
// fallbackPath=header.jpg — same order as the real component (the day-list card below uses the
// opposite order, matching CalendarMonth.svelte's phone branch exactly).
export function CalendarGridCell({
    day, isToday, entries, releases, apiHost,
}: {
    day:      number
    isToday:  boolean
    entries:  DayEntry[]
    releases: ReleaseEntry[]
    apiHost:  string | undefined
}) {
    const { items, overflow } = useMemo(() => {
        const real       = entries.filter(e => !e.lastPlayed).sort((a, b) => b.durationMin - a.durationMin)
        const historical = entries.filter(e => e.lastPlayed).sort((a, b) => a.name.localeCompare(b.name))
        const all: CellEntry[] = [
            ...releases.map(r => ({ appid: r.appid, name: r.name, isRelease: true, durationMin: 0, isLive: false, lastPlayed: false })),
            ...real.map(e => ({ appid: e.appid, name: e.name, isRelease: false, durationMin: e.durationMin, isLive: !!e.isLive, lastPlayed: false })),
            ...historical.map(e => ({ appid: e.appid, name: e.name, isRelease: false, durationMin: e.durationMin, isLive: false, lastPlayed: true })),
        ]
        return { items: all.slice(0, 3), overflow: Math.max(0, all.length - 3) }
    }, [entries, releases])

    const asGrid = items.length >= 3

    return (
        <View style={[styles.cell, isToday && styles.cellToday]}>
            <Text style={[styles.dayNum, isToday && styles.dayNumToday]}>{day}</Text>
            <View style={[styles.entries, asGrid && styles.entriesGrid]}>
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
                        primaryPath={`/relay/images/steam/games/${e.appid}/poster.jpg`}
                        fallbackPath={`/relay/images/steam/games/${e.appid}/header.jpg`}
                        style={asGrid ? styles.tileGrid : styles.tileRow}
                        overflow={i === items.length - 1 ? overflow : 0}
                    />
                ))}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    cell:         { flex: 1, backgroundColor: colors.bgRaised, minHeight: 0 },
    cellToday:    {},
    dayNum: {
        fontSize: 10, color: colors.textMuted, lineHeight: 12,
        paddingVertical: 3, paddingHorizontal: 6, marginHorizontal: 2,
        backgroundColor: 'rgba(140,125,110,0.10)', fontFamily: fonts.ui,
    },
    dayNumToday: {
        color: colors.bg, fontFamily: fonts.uiBold,
        backgroundColor: colors.accent, alignSelf: 'flex-start',
        borderRadius: 3,
    },
    entries: {
        flex: 1, flexDirection: 'row', gap: 2, paddingHorizontal: 2, paddingBottom: 2, minHeight: 0,
    },
    entriesGrid: { flexWrap: 'wrap' },
    tileRow:  { flex: 1, minWidth: 0, minHeight: 0 },
    tileGrid: { width: '49%', height: '49%' },
})
