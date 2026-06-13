<script lang="ts">
    import type { JournalSession } from '../../types.js'
    import { fmtDate } from '../../js/views/journal-render.js'

    interface Props { sessions: JournalSession[] }
    let { sessions }: Props = $props()

    function fmtDur(mins: number): string {
        const h = Math.floor(mins / 60)
        const m = mins % 60
        if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
        return `${m}m`
    }
</script>

<div class="gj-card gj-card--wide gj-card--sessions-rail">
    <div class="gj-card-header">
        <span class="gj-card-title">Past Sessions</span>
        <span class="gj-sessions-count">{sessions.length} total</span>
    </div>
    <div class="gj-sessions-scroll">
        {#each sessions.slice(0, 30) as s}
            {@const mins = s.durationMin ?? 0}
            {@const achs = s.achievements?.length ?? 0}
            <div class="gj-session-chip">
                <span class="gj-session-chip-when">{fmtDate(s.startedAt)}</span>
                <span class="gj-session-chip-dur">{mins ? fmtDur(mins) : '—'}</span>
                <span class="gj-session-chip-achs">{achs ? `${achs} achieve` : '—'}</span>
            </div>
        {/each}
    </div>
</div>
