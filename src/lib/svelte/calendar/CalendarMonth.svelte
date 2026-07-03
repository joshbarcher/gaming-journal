<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte'
    import type { DayEntry, ReleaseEntry } from '../../js/views/calendar-render.js'
    import { DOW, fmt } from '../../js/views/calendar-render.js'
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

    const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    let firstDow    = $derived(new Date(year, monthIdx, 1).getDay())
    let daysInMonth = $derived(new Date(year, monthIdx + 1, 0).getDate())
    let isCurrent   = $derived(today.startsWith(`${year}-${String(monthIdx + 1).padStart(2, '0')}`))
    let weekRows    = $derived(Math.ceil((firstDow + daysInMonth) / 7))
    let gridRows    = $derived(`auto ${Array(weekRows).fill('1fr').join(' ')}`)

    let isPhone = $state(false)
    let _mq: MediaQueryList | null = null

    function handleMQ(e: MediaQueryListEvent) { isPhone = e.matches }

    onMount(() => {
        _mq = window.matchMedia('(max-width: 479px)')
        isPhone = _mq.matches
        _mq.addEventListener('change', handleMQ)
    })

    onDestroy(() => {
        _mq?.removeEventListener('change', handleMQ)
    })

    function dateStr(d: number) {
        return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }

    interface ListItem {
        appid:       number
        name:        string
        isRelease:   boolean
        durationMin: number
        isLive:      boolean
        lastPlayed:  boolean
    }

    function getListItems(ds: string): { items: ListItem[]; overflow: number } {
        const dayEntries  = mode === 'play'     ? (dayMap.get(ds)     ?? []) : []
        const dayReleases = mode === 'releases' ? (releaseMap.get(ds) ?? []) : []

        const real       = dayEntries.filter(e => !e.lastPlayed).sort((a, b) => b.durationMin - a.durationMin)
        const historical = dayEntries.filter(e =>  e.lastPlayed).sort((a, b) => a.name.localeCompare(b.name))

        const all: ListItem[] = [
            ...dayReleases.map(r  => ({ appid: r.appid, name: r.name, isRelease: true,  durationMin: 0,            isLive: false,     lastPlayed: false })),
            ...real.map(e         => ({ appid: e.appid, name: e.name, isRelease: false, durationMin: e.durationMin, isLive: !!e.isLive, lastPlayed: false })),
            ...historical.map(e   => ({ appid: e.appid, name: e.name, isRelease: false, durationMin: e.durationMin, isLive: false,     lastPlayed: true  })),
        ]
        return { items: all.slice(0, 4), overflow: Math.max(0, all.length - 4) }
    }

    // Scroll today's card into view when the day list first renders for the current month
    $effect(() => {
        if (!isPhone || !isCurrent) return
        const t = today
        tick().then(() => {
            document.querySelector<HTMLElement>(`.cal-daylist-card[data-date="${t}"]`)
                ?.scrollIntoView({ behavior: 'instant', block: 'start' })
        })
    })
</script>

{#if isPhone}
    <div class="cal-daylist">
        {#each { length: daysInMonth } as _, i}
            {@const ds      = dateStr(i + 1)}
            {@const isToday = ds === today}
            {@const dow     = new Date(year, monthIdx, i + 1).getDay()}
            {@const { items, overflow } = getListItems(ds)}
            <div
                class="cal-daylist-card"
                class:cal-daylist-card--today={isToday}
                data-date={ds}
            >
                <div class="cal-daylist-header">
                    <span class="cal-daylist-num">{i + 1}</span>
                    <span class="cal-daylist-dow">{DOW_SHORT[dow]}</span>
                    {#if isToday}<span class="cal-daylist-today-label">Today</span>{/if}
                </div>

                {#if items.length > 0}
                    <div
                        class="cal-daylist-entries"
                        class:cal-daylist-entries--two={items.length === 2}
                        class:cal-daylist-entries--quad={items.length >= 3}
                    >
                        {#each items as e, j}
                            {@const timeLabel = fmt(e.durationMin)}
                            <a
                                class="cal-daylist-entry"
                                class:cal-daylist-entry--last-played={e.lastPlayed && !e.isLive}
                                href="/game/{e.appid}"
                                data-game-card data-appid={e.appid} data-game-name={e.name}
                                title="{e.name}"
                            >
                                <img
                                    class="cal-daylist-img"
                                    src="/relay/images/steam/games/{e.appid}/header.jpg"
                                    alt=""
                                    loading="lazy"
                                    onerror={(ev) => {
                                        const img = ev.currentTarget as HTMLImageElement
                                        if (!img.dataset.fb) {
                                            img.dataset.fb = '1'
                                            img.src = `/relay/images/steam/games/${e.appid}/poster.jpg`
                                        } else {
                                            img.style.display = 'none'
                                        }
                                    }}
                                />
                                <div class="cal-entry-overlay">
                                    <span
                                        class="cal-entry-tag"
                                        class:cal-entry-tag--release={e.isRelease}
                                        class:cal-entry-tag--live={e.isLive}
                                        class:cal-entry-tag--last-played={e.lastPlayed && !e.isLive}
                                    >
                                        {#if e.isLive}<span class="cal-live-dot"></span>{/if}
                                        {#if e.isRelease}REL{:else if e.lastPlayed && !e.isLive}last played{:else}{timeLabel}{/if}
                                    </span>
                                </div>
                                {#if j === items.length - 1 && overflow > 0}
                                    <span class="cal-overflow">+{overflow}</span>
                                {/if}
                            </a>
                        {/each}
                    </div>
                {:else}
                    <div class="cal-daylist-empty-space"></div>
                {/if}
            </div>
        {/each}
    </div>
{:else}
    <div class="cal-month">
        <div class="cal-month-name">{name}</div>
        <div class="cal-month-grid" style="grid-template-rows: {gridRows}">
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
{/if}
