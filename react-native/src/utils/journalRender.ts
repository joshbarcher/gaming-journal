// Ported from src/lib/js/views/journal-render.ts. fmtHours here is byte-identical to
// utils/gameRender.ts's fmtHours (same source function, duplicated on the web across two files) —
// reused from there instead of copied a third time.
import type { AchievementItem } from 'gaming-journal-contracts/achievements'
import type { SessionAchievement } from 'gaming-journal-contracts/journalSessions'

export function fmtDate(date: string | number | Date | null | undefined): string {
    if (!date) return ''
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function cleanAchName(apiname: string): string {
    return apiname
        .replace(/^[A-Z0-9]+_/, '')
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase())
}

export function mergeSessionAchievements(
    achList: AchievementItem[],
    achievementsDuring: SessionAchievement[] | null | undefined,
): AchievementItem[] {
    if (!achievementsDuring?.length) return achList
    const sessionMap: Record<string, SessionAchievement> = {}
    for (const a of achievementsDuring) sessionMap[a.apiname] = a
    return achList.map(a =>
        (!a.achieved && sessionMap[a.apiname])
            ? { ...a, achieved: 1, unlocktime: sessionMap[a.apiname].unlocktime ?? Math.floor(Date.now() / 1000) }
            : a,
    )
}

export const RATING_KEYS = ['story', 'soundMusic', 'gameplay', 'graphics', 'replayability', 'performance', 'agendaFree']
export const RATING_LBLS: Record<string, string> = {
    story: 'Story', soundMusic: 'Sound & Music', gameplay: 'Gameplay', graphics: 'Graphics',
    replayability: 'Replayability', performance: 'Performance', agendaFree: 'Agenda-Free',
}
export const TRACKER_TYPES = ['progress', 'progress-bars', 'counter', 'multi-counter']

// Ported from journal-render.ts's TRACKER_META — labels + a simple text mark per type. The
// multi-bar type has no text icon: its glyph was the only emoji (📊) and now renders as a Lucide
// <bar-chart> in the consumer (JournalProgress), keyed by type. The other marks (✓ / #) are plain
// symbols, left as-is.
export const TRACKER_META: Record<string, { label: string; icon: string }> = {
    progress: { label: 'Progress tracker', icon: '✓' },
    'progress-bars': { label: 'Multi-bar tracker', icon: '' },
    counter: { label: 'Counter', icon: '#' },
    'multi-counter': { label: 'Multi-counter', icon: '#' },
}

const CHIP_COLORS = [
    { bg: 'rgba(220, 80,  80,  0.12)', border: 'rgba(220, 80,  80,  0.55)' },
    { bg: 'rgba(220, 140, 60,  0.12)', border: 'rgba(220, 140, 60,  0.55)' },
    { bg: 'rgba(201, 168, 76,  0.12)', border: 'rgba(201, 168, 76,  0.55)' },
    { bg: 'rgba(100, 200, 100, 0.12)', border: 'rgba(100, 200, 100, 0.55)' },
    { bg: 'rgba(78,  205, 196, 0.12)', border: 'rgba(78,  205, 196, 0.55)' },
    { bg: 'rgba(60,  180, 220, 0.12)', border: 'rgba(60,  180, 220, 0.55)' },
    { bg: 'rgba(122, 184, 245, 0.12)', border: 'rgba(122, 184, 245, 0.55)' },
    { bg: 'rgba(120, 100, 230, 0.12)', border: 'rgba(120, 100, 230, 0.55)' },
    { bg: 'rgba(180, 100, 220, 0.12)', border: 'rgba(180, 100, 220, 0.55)' },
    { bg: 'rgba(220, 100, 160, 0.12)', border: 'rgba(220, 100, 160, 0.55)' },
]

// Ported verbatim from SessionHistoryRail.svelte's chipColor() — a deterministic hash of the
// session's startedAt string picks a stable color per session (not random per render).
export function chipColor(startedAt: string) {
    let h = 0
    for (let i = 0; i < startedAt.length; i++) h = (h * 31 + startedAt.charCodeAt(i)) & 0xffff
    return CHIP_COLORS[h % CHIP_COLORS.length]
}

export function fmtDur(mins: number): string {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
    return `${m}m`
}

export function fmtAchs(n: number): string {
    if (!n) return '—'
    return n === 1 ? '1 achievement' : `${n} achievements`
}
