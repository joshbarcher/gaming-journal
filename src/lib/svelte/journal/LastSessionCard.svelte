<script lang="ts">
    import type { AchievementItem, JournalSession, SessionAchievement } from '../../types.js'
    import { fmtDate } from '../../js/views/journal-render.js'
    import SessionAchievements from './SessionAchievements.svelte'

    interface Props {
        sessions:       JournalSession[]
        displayAchList: AchievementItem[]
        appid:          string | number
        // When the game is the current now-playing title, the dashboard passes
        // the live session in so this card flips to "Current Session" with a
        // running timer instead of showing the last ended session.
        isActive?:      boolean
        activeElapsed?: string
        activeAchs?:    SessionAchievement[]
    }
    let {
        sessions, displayAchList, appid,
        isActive = false, activeElapsed = '—', activeAchs = [],
    }: Props = $props()

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

<div class="gj-card gj-card--game-bg" class:gj-card--live={isActive}
     style="--gj-game-bg: url('/relay/images/steam/games/{appid}/header.jpg'); min-height: 160px">
    <div class="gj-card-header">
        <span class="gj-card-title">
            {#if isActive}<span class="gj-live-dot" aria-hidden="true"></span>Current Session{:else}Last Session{/if}
        </span>
        {#if isActive}
            <span class="gj-session-date-chip gj-session-date-chip--live">Now</span>
        {:else if last}
            <span class="gj-session-date-chip">{fmtDate(last.startedAt)}</span>
        {/if}
    </div>

    {#if isActive}
        <div class="gj-session-stat">
            <span class="gj-session-big">{activeElapsed}</span>
            <span class="gj-session-sublabel">this session</span>
        </div>
        {#if activeAchs.length}
            <p class="gj-ach-recent-label">Earned ({activeAchs.length})</p>
        {/if}
        <SessionAchievements achs={activeAchs} {achMap} noDataMsg="No achievements yet this session" />
    {:else if !last}
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

<style>
    /* Live "Current Session" affordances — scoped; only this card uses them. */
    .gj-card-title { display: inline-flex; align-items: center; gap: 0.45rem; }

    .gj-live-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #4ade80;
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.55);
        animation: gj-live-pulse 2s ease-out infinite;
        flex: none;
    }
    @keyframes gj-live-pulse {
        0%   { box-shadow: 0 0 0 0   rgba(74, 222, 128, 0.5); }
        70%  { box-shadow: 0 0 0 7px rgba(74, 222, 128, 0);   }
        100% { box-shadow: 0 0 0 0   rgba(74, 222, 128, 0);   }
    }

    .gj-session-date-chip--live {
        color: #4ade80;
        border-color: rgba(74, 222, 128, 0.4);
    }
</style>
