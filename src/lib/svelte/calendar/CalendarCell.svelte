<script lang="ts">
    import type { DayEntry, ReleaseEntry } from '../../js/views/calendar-render.js'
    import { fmt } from '../../js/views/calendar-render.js'

    interface CellEntry {
        appid:        number
        name:         string
        isRelease:    boolean
        durationMin?: number
        isLive?:      boolean
    }

    interface Props {
        day:       number
        isToday:   boolean
        entries:   DayEntry[]
        releases:  ReleaseEntry[]
    }

    let { day, isToday, entries, releases }: Props = $props()

    let display  = $derived.by(() => {
        const sorted = [...entries].sort((a, b) => b.durationMin - a.durationMin)
        const all: CellEntry[] = [
            ...releases.map(r => ({ ...r, isRelease: true })),
            ...sorted.map(e => ({ ...e, isRelease: false })),
        ]
        return { items: all.slice(0, 3), overflow: all.length - Math.min(all.length, 3) }
    })
</script>

<div
    class="cal-cell"
    class:cal-cell--today={isToday}
    class:cal-cell--played={entries.length > 0}
    class:cal-cell--release-day={releases.length > 0}
>
    <span class="cal-day-num">{day}</span>
    <div class="cal-entries">
        {#each display.items as e, i}
            {@const timeLabel = fmt(e.durationMin ?? 0)}
            {@const title = e.isRelease
                ? `${e.name} — Release day`
                : `${e.name} — ${timeLabel}${e.isLive ? ' (live)' : ''}`}
            <a
                class="cal-entry"
                class:cal-entry--release={e.isRelease}
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
                        <span class="cal-entry-tag" class:cal-entry-tag--live={e.isLive}>
                            {#if e.isLive}<span class="cal-live-dot"></span>{/if}
                            {timeLabel}
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
