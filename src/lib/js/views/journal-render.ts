import type { AchievementItem, SessionAchievement } from '../../types.js'

// ── SVG icons ─────────────────────────────────────────────────────────────────

const _ic = (d: string, size = 14) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;vertical-align:middle">${d}</svg>`

export const IC = {
    pin:   _ic(`<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>`),
    bars:  _ic(`<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`),
    check: _ic(`<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`),
    file:  _ic(`<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>`),
    notes: _ic(`<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><polyline points="15 3 15 9 21 9"/><line x1="9" x2="15" y1="13" y2="13"/><line x1="9" x2="12" y1="17" y2="17"/>`),
    hash:  _ic(`<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>`),
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const STAR_LABELS  = ['Not Rated', '1 Star', '2 Stars', '3 Stars', '4 Stars', '5 Stars', 'Legendary']
export const RATING_KEYS  = ['story', 'soundMusic', 'gameplay', 'graphics', 'replayability', 'performance', 'agendaFree']
export const RATING_LBLS: Record<string, string>  = { story: 'Story', soundMusic: 'Sound & Music', gameplay: 'Gameplay', graphics: 'Graphics', replayability: 'Replayability', performance: 'Performance', agendaFree: 'Agenda-Free' }
export const TRACKER_TYPES = ['progress', 'progress-bars', 'counter', 'multi-counter']
export const TRACKER_META: Record<string, { label: string; icon: () => string }> = {
    'progress':       { label: 'Progress tracker', icon: () => IC.check },
    'progress-bars':  { label: 'Multi-bar tracker', icon: () => IC.bars  },
    'counter':        { label: 'Counter',            icon: () => IC.hash  },
    'multi-counter':  { label: 'Multi-counter',      icon: () => IC.hash  },
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtDate(date: string | number | Date | null | undefined): string {
    if (!date) return ''
    const d = new Date(date)
    if (isNaN(d.getTime())) return ''  // garbage input must not render "Invalid Date"
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function cleanAchName(apiname: string): string {
    return apiname
        .replace(/^[A-Z0-9]+_/, '')
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase())
}

export function fmtHours(h: number | null | undefined): string {
    if (h == null) return '—'
    if (h >= 100)  return `${Math.round(h)}h`
    if (h >= 10)   return `${(Math.round(h * 2) / 2)}h`
    return `${(Math.round(h * 10) / 10)}h`
}


// ── Achievement helpers ───────────────────────────────────────────────────────

export function mergeSessionAchievements(
    achList: AchievementItem[],
    achievementsDuring: SessionAchievement[] | null | undefined
): AchievementItem[] {
    if (!achievementsDuring?.length) return achList
    const sessionMap: Record<string, SessionAchievement> = {}
    for (const a of achievementsDuring) sessionMap[a.apiname] = a
    return achList.map(a =>
        (!a.achieved && sessionMap[a.apiname])
            ? { ...a, achieved: 1, unlocktime: sessionMap[a.apiname].unlocktime ?? Math.floor(Date.now() / 1000) }
            : a
    )
}

