<script lang="ts">
    import type { AchievementItem, JournalSession } from '../../types.js'
    import { fmtDate } from '../../js/views/journal-render.js'
    import SessionAchievements from './SessionAchievements.svelte'

    interface Props {
        sessions:       JournalSession[]
        displayAchList: AchievementItem[]
        appid:          string | number
    }
    let { sessions, displayAchList, appid }: Props = $props()

    let last = $derived.by(() => {
        const sorted = [...sessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        return sorted[0] ?? null
    })

    let achMap = $derived(Object.fromEntries(displayAchList.map(a => [a.apiname, a])))

    let duration = $derived.by(() => {
        const mins = last?.durationMin ?? 0
        return mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`
    })
</script>

<div class="gj-card gj-card--game-bg" style="--gj-game-bg: url('/relay/images/steam/games/{appid}/header.jpg'); min-height: 160px">
    <div class="gj-card-header">
        <span class="gj-card-title">Last Session</span>
        {#if last}<span class="gj-session-date-chip">{fmtDate(last.startedAt)}</span>{/if}
    </div>
    {#if !last}
        <p class="gj-no-data">No sessions recorded yet</p>
    {:else}
        <div class="gj-session-stat">
            <span class="gj-session-big">{duration}</span>
            <span class="gj-session-sublabel">played</span>
        </div>
        {#if (last.achievements ?? []).length}
            <p class="gj-ach-recent-label">Earned ({last.achievements!.length})</p>
        {/if}
        <SessionAchievements achs={last.achievements ?? []} {achMap} />
    {/if}
</div>
