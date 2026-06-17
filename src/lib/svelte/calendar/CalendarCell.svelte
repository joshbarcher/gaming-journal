<script lang="ts">
    import type { DayEntry, ReleaseEntry } from '../../js/views/calendar-render.js'
    import { fmt } from '../../js/views/calendar-render.js'

    interface CellEntry {
        appid:        number
        name:         string
        isRelease:    boolean
        durationMin?: number
        isLive?:      boolean
        lastPlayed?:  boolean
    }

    interface Props {
        day:       number
        isToday:   boolean
        entries:   DayEntry[]
        releases:  ReleaseEntry[]
    }

    let { day, isToday, entries, releases }: Props = $props()

    let display  = $derived.by(() => {
        const real       = entries.filter(e => !e.lastPlayed).sort((a, b) => b.durationMin - a.durationMin)
        const historical = entries.filter(e =>  e.lastPlayed).sort((a, b) => a.name.localeCompare(b.name))
        const all: CellEntry[] = [
            ...releases.map(r => ({ ...r, isRelease: true })),
            ...real.map(e => ({ ...e, isRelease: false })),
            ...historical.map(e => ({ ...e, isRelease: false })),
        ]
        return { items: all.slice(0, 3), overflow: all.length - Math.min(all.length, 3) }
    })
</script>

<div
    class="cal-cell"
    class:cal-cell--today={isToday}
    class:cal-cell--played={entries.some(e => !e.lastPlayed)}
    class:cal-cell--release-day={releases.length > 0}
>
    <span class="cal-day-num">{day}</span>
    <div class="cal-entries" class:cal-entries--grid={display.items.length >= 3}>
        {#each display.items as e, i}
            {@const timeLabel = fmt(e.durationMin ?? 0)}
            {@const title = e.isRelease
                ? `${e.name} — Release day`
                : e.lastPlayed && !e.isLive
                ? `${e.name} — last played`
                : `${e.name} — ${timeLabel}${e.isLive ? ' (live)' : ''}`}
            <a
                class="cal-entry"
                class:cal-entry--release={e.isRelease}
                class:cal-entry--last-played={e.lastPlayed && !e.isLive}
                href="/game/{e.appid}"
                {title}
            >
                <img
                    class="cal-entry-img"
                    src="/relay/images/steam/games/{e.appid}/poster.jpg"
                    alt=""
                    loading="lazy"
                    onerror={(ev) => {
                        const img = ev.currentTarget as HTMLImageElement
                        if (!img.dataset.fb) {
                            img.dataset.fb = '1'
                            img.src = `/relay/images/steam/games/${e.appid}/header.jpg`
                        } else {
                            img.style.display = 'none'
                        }
                    }}
                />
                {#if !e.isRelease}
                    <div class="cal-entry-overlay">
                        <span class="cal-entry-tag" class:cal-entry-tag--live={e.isLive} class:cal-entry-tag--last-played={e.lastPlayed && !e.isLive}>
                            {#if e.isLive}<span class="cal-live-dot"></span>{/if}
                            {e.lastPlayed && !e.isLive ? 'last played' : timeLabel}
                        </span>
                    </div>
                {/if}
                {#if !e.isRelease && i === display.items.length - 1 && display.overflow > 0}
                    <span class="cal-overflow">+{display.overflow}</span>
                {/if}
            </a>
        {/each}
    </div>
</div>
