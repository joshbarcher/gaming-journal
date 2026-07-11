<script lang="ts">
    import type { AchievementItem, JournalSession, SessionAchievement } from '../../types.js'
    import { fmtDate } from '../../js/views/journal-render.js'
    import SessionAchievements from './SessionAchievements.svelte'

    interface Props {
        sessions:       JournalSession[]
        displayAchList: AchievementItem[]
        appid:          string | number
        // When the game is the current now-playing title, the dashboard passes
        // the live session in so this card flips to the "Playing Now" state.
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

{#if isActive}
    <!-- Currently playing: bright game-header background with a directional
         scrim for text legibility (same treatment as the sidebar now-playing
         card), plus the green "active" border + pulsing dot. -->
    <div class="gj-card gj-card--active-session gj-card--playing-bg"
         style="--gj-game-bg: url('/relay/images/steam/games/{appid}/header.jpg'); min-height: 160px">
        <div class="gj-card-header">
            <span class="gj-card-title">Playing Now</span>
            <span class="gj-active-dot"></span>
        </div>
        <div class="gj-session-stat">
            <span class="gj-session-big">{activeElapsed}</span>
            <span class="gj-session-sublabel">so far</span>
        </div>
        {#if activeAchs.length}
            <p class="gj-ach-recent-label">Earned ({activeAchs.length})</p>
        {/if}
        <SessionAchievements achs={activeAchs} {achMap} noDataMsg="No achievements yet this session" />
    </div>
{:else}
    <div class="gj-card gj-card--game-bg"
         style="--gj-game-bg: url('/relay/images/steam/games/{appid}/header.jpg'); min-height: 160px">
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
{/if}

<style>
    /* Bright game-header background for the live session card, with a
       left-weighted scrim so the timer/label stay readable over the art. */
    .gj-card--playing-bg { position: relative; overflow: hidden; }

    .gj-card--playing-bg::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 0;
        background: var(--gj-game-bg, none) center top / cover no-repeat;
        pointer-events: none;
    }

    .gj-card--playing-bg::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 0;
        background: linear-gradient(
            105deg,
            rgba(12, 18, 14, 0.94) 0%,
            rgba(12, 18, 14, 0.72) 38%,
            rgba(12, 18, 14, 0.32) 72%,
            rgba(12, 18, 14, 0.10) 100%
        );
        pointer-events: none;
    }

    /* Lift the card's real content above the image + scrim layers. */
    .gj-card--playing-bg > * { position: relative; z-index: 1; }
</style>
