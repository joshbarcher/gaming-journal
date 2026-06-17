<script lang="ts">
    import type { JournalSession } from '../../types.js'
    import { fmtDate } from '../../js/views/journal-render.js'

    interface Props { sessions: JournalSession[] }
    let { sessions }: Props = $props()

    const CHIP_COLORS = [
        { bg: 'rgba(220, 80,  80,  0.12)', border: 'rgba(220, 80,  80,  0.55)' },  // red
        { bg: 'rgba(220, 140, 60,  0.12)', border: 'rgba(220, 140, 60,  0.55)' },  // orange
        { bg: 'rgba(201, 168, 76,  0.12)', border: 'rgba(201, 168, 76,  0.55)' },  // gold
        { bg: 'rgba(100, 200, 100, 0.12)', border: 'rgba(100, 200, 100, 0.55)' },  // green
        { bg: 'rgba(78,  205, 196, 0.12)', border: 'rgba(78,  205, 196, 0.55)' },  // teal
        { bg: 'rgba(60,  180, 220, 0.12)', border: 'rgba(60,  180, 220, 0.55)' },  // cyan
        { bg: 'rgba(122, 184, 245, 0.12)', border: 'rgba(122, 184, 245, 0.55)' },  // blue
        { bg: 'rgba(120, 100, 230, 0.12)', border: 'rgba(120, 100, 230, 0.55)' },  // indigo
        { bg: 'rgba(180, 100, 220, 0.12)', border: 'rgba(180, 100, 220, 0.55)' },  // purple
        { bg: 'rgba(220, 100, 160, 0.12)', border: 'rgba(220, 100, 160, 0.55)' },  // pink
    ]

    function chipColor(startedAt: string) {
        let h = 0
        for (let i = 0; i < startedAt.length; i++) h = (h * 31 + startedAt.charCodeAt(i)) & 0xffff
        return CHIP_COLORS[h % CHIP_COLORS.length]
    }

    function fmtDur(mins: number): string {
        const h = Math.floor(mins / 60)
        const m = mins % 60
        if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
        return `${m}m`
    }

    function fmtAchs(n: number): string {
        if (!n) return '—'
        return n === 1 ? '1 achievement' : `${n} achievements`
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
            {@const color = chipColor(s.startedAt)}
            <div class="gj-session-chip" style="background:{color.bg};border-color:{color.border}">
                <span class="gj-session-chip-when">{fmtDate(s.startedAt)}</span>
                <span class="gj-session-chip-dur">{mins ? fmtDur(mins) : '—'}</span>
                <span class="gj-session-chip-achs">{fmtAchs(achs)}</span>
            </div>
        {/each}
    </div>
</div>
