import { useEffect, useMemo, useRef } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'

import { colors, fonts } from '@/theme/tokens'
import { DOW, type DayEntry, type ReleaseEntry } from '@/utils/calendarRender'
import { CalendarDayCard } from './CalendarDayCard'
import { CalendarGridCell } from './CalendarGridCell'

// Port of CalendarMonth.svelte. `isPhone` is driven by the same breakpoint hook the rest of the
// app uses (mobilePortrait ⇔ the web's own `matchMedia('(max-width: 479px)')`), rather than a
// second independent media query — same threshold, single source of truth.
export function CalendarMonth({
    year, monthIdx, today, dayMap, releaseMap, mode, isPhone, apiHost,
}: {
    year:       number
    monthIdx:   number
    today:      string
    dayMap:     Map<string, DayEntry[]>
    releaseMap: Map<string, ReleaseEntry[]>
    mode:       string
    isPhone:    boolean
    apiHost:    string | undefined
}) {
    const firstDow    = new Date(year, monthIdx, 1).getDay()
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate()
    const isCurrentMonth = today.startsWith(`${year}-${String(monthIdx + 1).padStart(2, '0')}`)

    function dateStr(d: number) {
        return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }

    const listRef = useRef<FlatList>(null)
    useEffect(() => {
        if (!isPhone || !isCurrentMonth) return
        const todayIdx = Number(today.slice(-2)) - 1
        const t = setTimeout(() => listRef.current?.scrollToIndex({ index: todayIdx, animated: false }), 50)
        return () => clearTimeout(t)
    }, [isPhone, isCurrentMonth, today, monthIdx, year])

    const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

    if (isPhone) {
        return (
            <FlatList
                ref={listRef}
                style={styles.dayList}
                data={days}
                keyExtractor={(d) => String(d)}
                onScrollToIndexFailed={() => {}}
                renderItem={({ item: d }) => {
                    const ds = dateStr(d)
                    return (
                        <CalendarDayCard
                            day={d}
                            dow={new Date(year, monthIdx, d).getDay()}
                            isToday={ds === today}
                            isCurrentTodayCard={ds === today}
                            entries={mode === 'play' ? (dayMap.get(ds) ?? []) : []}
                            releases={mode === 'releases' ? (releaseMap.get(ds) ?? []) : []}
                            mode={mode}
                            apiHost={apiHost}
                        />
                    )
                }}
            />
        )
    }

    const weeks: (number | null)[][] = []
    let week: (number | null)[] = new Array(firstDow).fill(null)
    for (let d = 1; d <= daysInMonth; d++) {
        week.push(d)
        if (week.length === 7) { weeks.push(week); week = [] }
    }
    if (week.length) { while (week.length < 7) week.push(null); weeks.push(week) }

    return (
        <View style={styles.month}>
            <View style={styles.dowRow}>
                {DOW.map((d) => <Text key={d} style={styles.dowLabel}>{d}</Text>)}
            </View>
            <View style={styles.weeksWrap}>
                {weeks.map((w, wi) => (
                    <View key={wi} style={styles.weekRow}>
                        {w.map((d, di) => d === null ? (
                            <View key={di} style={styles.emptyCell} />
                        ) : (
                            <CalendarGridCell
                                key={di}
                                day={d}
                                isToday={dateStr(d) === today}
                                entries={mode === 'play' ? (dayMap.get(dateStr(d)) ?? []) : []}
                                releases={mode === 'releases' ? (releaseMap.get(dateStr(d)) ?? []) : []}
                                apiHost={apiHost}
                            />
                        ))}
                    </View>
                ))}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    dayList: { flex: 1 },
    month: {
        flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
        overflow: 'hidden', backgroundColor: colors.bgRaised,
    },
    dowRow: { flexDirection: 'row' },
    dowLabel: {
        flex: 1, textAlign: 'center', paddingVertical: 4, fontSize: 9,
        color: colors.textMuted, textTransform: 'uppercase', fontFamily: fonts.ui,
        backgroundColor: colors.bgRaised,
    },
    weeksWrap: { flex: 1 },
    weekRow: { flex: 1, flexDirection: 'row', gap: 1 },
    emptyCell: { flex: 1, backgroundColor: colors.bg },
})
