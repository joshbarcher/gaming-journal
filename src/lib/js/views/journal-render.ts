import { escapeHtml } from '../utils.js'
import type { AchievementItem, SessionAchievement, JournalSession } from '../../types.js'

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
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

export function starsHtml(stars: number | null | undefined): string {
    if (stars == null || stars === 0) return ''
    const isLegendary  = stars === 6
    const displayStars = isLegendary ? 5 : stars
    let out = ''
    for (let i = 1; i <= 5; i++) {
        out += `<span class="gj-star${i <= displayStars ? ' gj-star--on' : ''}">${i <= displayStars ? '★' : '☆'}</span>`
    }
    if (isLegendary) out += `<span class="gj-star-legendary">✦ Legendary</span>`
    return out
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

export function renderRecentAchStrip(recent: AchievementItem[]): string {
    return recent.map(a => {
        const src        = a.localIcon ?? a.icon ?? null
        const fallback   = a.icon ?? null
        const name       = a.displayName ?? cleanAchName(a.apiname)
        const date       = fmtDate(new Date((a.unlocktime ?? 0) * 1000))
        const errHandler = src && fallback && src !== fallback
            ? `this.onerror=null;this.src='${fallback}'`
            : `this.style.visibility='hidden'`
        return `<div class="gj-ach-strip-item" title="${escapeHtml(name)}">
            ${src
              ? `<img class="gj-ach-strip-img" src="${src}" alt="" onerror="${errHandler}">`
              : `<div class="gj-ach-strip-fallback">${escapeHtml(name[0]?.toUpperCase() ?? '?')}</div>`}
            <span class="gj-ach-strip-name">${escapeHtml(name)}</span>
            <span class="gj-ach-strip-date">${date}</span>
        </div>`
    }).join('')
}

export function renderSessionAchs(
    achs: SessionAchievement[],
    achMap: Record<string, AchievementItem>,
    noDataMsg = 'No achievements this session'
): string {
    if (!achs.length) return `<p class="gj-no-data">${escapeHtml(noDataMsg)}</p>`
    return `<div class="gj-session-achs">
        ${achs.slice(0, 8).map(a => {
            const full       = achMap[a.apiname]
            const name       = full?.displayName ?? cleanAchName(a.apiname)
            const src        = full?.localIcon ?? full?.icon ?? null
            const fallback   = full?.icon ?? null
            const errHandler = src && fallback && src !== fallback
                ? `this.onerror=null;this.src='${fallback}'`
                : `this.style.visibility='hidden'`
            return `<div class="gj-session-ach" title="${escapeHtml(name)}">
                ${src
                  ? `<img class="gj-session-ach-img" src="${src}" alt="" onerror="${errHandler}">`
                  : `<div class="gj-session-ach-img gj-session-ach-img--fallback">${escapeHtml(name[0]?.toUpperCase() ?? '?')}</div>`}
            </div>`
        }).join('')}
        ${achs.length > 8 ? `<span class="gj-session-ach-more">+${achs.length - 8} more</span>` : ''}
    </div>`
}

export function renderAchItem(a: AchievementItem, isUnlocked: boolean, isHidden: boolean): string {
    const name        = a.displayName ?? cleanAchName(a.apiname)
    const localSrc    = isUnlocked ? (a.localIcon ?? null) : (a.localIconGray ?? null)
    const cdnFallback = isUnlocked ? (a.icon ?? null)      : (a.icongray ?? a.icon ?? null)
    const imgSrc      = localSrc ?? cdnFallback
    const letter      = name[0]?.toUpperCase() ?? '?'
    const date        = isUnlocked && a.unlocktime ? fmtDate(new Date(a.unlocktime * 1000)) : ''
    const desc        = !isHidden ? (a.description ?? '') : ''
    const badgeCls    = isUnlocked ? 'gj-ach-badge--unlocked' : 'gj-ach-badge--locked'

    const errHandler = localSrc && cdnFallback
        ? `this.onerror=null;this.src='${cdnFallback}'`
        : `this.outerHTML='<div class="gj-ach-badge ${badgeCls}">${letter}</div>'`

    const badgeHtml = imgSrc
        ? `<img class="gj-ach-badge" src="${imgSrc}" onerror="${errHandler}">`
        : `<div class="gj-ach-badge ${badgeCls}">${letter}</div>`

    return `
        <div class="gj-ach-full-item ${isUnlocked ? 'gj-ach-full-item--unlocked' : ''}">
            ${badgeHtml}
            <div class="gj-ach-info">
                <div class="gj-ach-full-name" data-tooltip="${escapeHtml(name)}">${escapeHtml(name)}</div>
                ${desc ? `<div class="gj-ach-full-desc" data-tooltip="${escapeHtml(desc)}">${escapeHtml(desc)}</div>` : ''}
                ${date ? `<div class="gj-ach-full-date">${date}</div>` : ''}
            </div>
        </div>`
}

export function renderLastSessionCard(sessions: JournalSession[], displayAchList: AchievementItem[], appid: string | number): string {
    const sorted = [...sessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    const last   = sorted[0] ?? null

    if (!last) {
        return `
        <div class="gj-card">
            <div class="gj-card-header"><span class="gj-card-title">Last Session</span></div>
            <p class="gj-no-data">No sessions recorded yet</p>
        </div>`
    }

    const mins     = last.durationMin ?? 0
    const duration = mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`
    const date     = fmtDate(last.startedAt)
    const achs     = last.achievements ?? []
    const bgUrl    = `/relay/images/steam/games/${appid}/header.jpg`

    const achMap: Record<string, AchievementItem> = {}
    for (const a of displayAchList) achMap[a.apiname] = a

    return `
        <div class="gj-card gj-card--game-bg" style="--gj-game-bg: url('${bgUrl}')">
            <div class="gj-card-header">
                <span class="gj-card-title">Last Session</span>
                <span class="gj-session-date-chip">${date}</span>
            </div>
            <div class="gj-session-stat">
                <span class="gj-session-big">${duration}</span>
                <span class="gj-session-sublabel">played</span>
            </div>
            ${achs.length ? `<p class="gj-ach-recent-label">Earned (${achs.length})</p>` : ''}
            ${renderSessionAchs(achs, achMap)}
        </div>`
}

export function renderSessionHistoryRail(closedSessions: JournalSession[]): string {
    const chips = closedSessions.slice(0, 30).map(s => {
        const mins = s.durationMin ?? 0
        const h    = Math.floor(mins / 60)
        const m    = mins % 60
        const dur  = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
        const achs = s.achievements?.length ?? 0
        return `
        <div class="gj-session-chip">
            <span class="gj-session-chip-when">${fmtDate(s.startedAt)}</span>
            <span class="gj-session-chip-dur">${dur || '—'}</span>
            <span class="gj-session-chip-achs">${achs ? `${achs} achieve` : '—'}</span>
        </div>`
    }).join('')

    return `
        <div class="gj-card gj-card--wide gj-card--sessions-rail">
            <div class="gj-card-header">
                <span class="gj-card-title">Past Sessions</span>
                <span class="gj-sessions-count">${closedSessions.length} total</span>
            </div>
            <div class="gj-sessions-scroll">${chips}</div>
        </div>`
}
