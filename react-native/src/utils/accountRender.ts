// Ported verbatim from Account.svelte's own local formatters. Distinct from utils/gameRender.ts's
// `fmtHours` (takes HOURS, different tiering) — these take MINUTES, and `fmtHrs`/`fmtMins` differ
// from each other only in their zero-case (`fmtHrs(0)` → '', `fmtMins(0)` → '0m'), matching the
// real component's own two near-identical functions rather than collapsing them into one.
export function fmtHrs(minutes: number | null | undefined): string {
    if (minutes == null) return ''
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

export function fmtMins(minutes: number | null | undefined): string {
    if (!minutes) return '0m'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    return `${h}h ${m}m`
}

export function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDayLabel(dayStr: string): string {
    return new Date(dayStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
