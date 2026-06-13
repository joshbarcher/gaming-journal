<script lang="ts">
    import type { DayEntry, ReleaseEntry } from '../../js/views/calendar-render.js'
    import { DOW } from '../../js/views/calendar-render.js'
    import CalendarCell from './CalendarCell.svelte'

    interface Props {
        year:       number
        monthIdx:   number
        name:       string
        today:      string
        dayMap:     Map<string, DayEntry[]>
        releaseMap: Map<string, ReleaseEntry[]>
        mode:       string
    }

    let { year, monthIdx, name, today, dayMap, releaseMap, mode }: Props = $props()

    let firstDow    = $derived(new Date(year, monthIdx, 1).getDay())
    let daysInMonth = $derived(new Date(year, monthIdx + 1, 0).getDate())
    let isCurrent   = $derived(today.startsWith(`${year}-${String(monthIdx + 1).padStart(2, '0')}`))

    function dateStr(d: number) {
        return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
</script>

<div class="cal-month" id={isCurrent ? 'cal-month-current' : undefined}>
    <div class="cal-month-name">{name}</div>
    <div class="cal-month-grid">
        {#each DOW as d}
            <div class="cal-dow">{d}</div>
        {/each}
        {#each { length: firstDow } as _}
            <div class="cal-cell cal-cell--empty"></div>
        {/each}
        {#each { length: daysInMonth } as _, i}
            {@const ds = dateStr(i + 1)}
            <CalendarCell
                day={i + 1}
                isToday={ds === today}
                entries={mode === 'play'     ? (dayMap.get(ds)     ?? []) : []}
                releases={mode === 'releases' ? (releaseMap.get(ds) ?? []) : []}
            />
        {/each}
        {#each { length: (7 - ((firstDow + daysInMonth) % 7)) % 7 } as _}
            <div class="cal-cell cal-cell--empty"></div>
        {/each}
    </div>
</div>
