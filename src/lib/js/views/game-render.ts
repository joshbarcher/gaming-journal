import type { SteamGame } from '../../types.js'

export type { ItadData, ProtonData, PcgwData } from '../../types.js'

// GameData is a minimal alias used by the render functions — SteamGame is a superset
export type GameData = SteamGame

// ── Release status ────────────────────────────────────────────────────────────

export function releaseStatus(game: GameData): string {
    if (!game.store || game.store.unavailable) return 'unknown'
    if ((game.store.categories ?? []).includes('Early Access')) return 'early_access'
    const dateStr = (game.store.releaseDate ?? '').trim()
    if (!dateStr) return 'unknown'
    const lower = dateStr.toLowerCase()
    if (['coming soon', 'to be announced', 'tba', 'tbd'].includes(lower)) return 'coming_soon'
    if (/^q[1-4]\s*\d{4}$/i.test(dateStr)) return 'coming_soon'
    if (/^\d{4}$/.test(dateStr)) return parseInt(dateStr, 10) > new Date().getFullYear() ? 'coming_soon' : 'released'
    const parsed = new Date(dateStr)
    if (!isNaN(parsed.getTime())) return parsed > new Date() ? 'coming_soon' : 'released'
    return 'unknown'
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtHours(h: number | null | undefined): string {
    if (h == null) return '—'
    if (h >= 100)  return `${Math.round(h)}h`
    if (h >= 10)   return `${(Math.round(h * 2) / 2)}h`
    return `${(Math.round(h * 10) / 10)}h`
}

export function fmtCount(n: number | null | undefined): string {
    if (n == null) return '0'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return String(n)
}

export function fmtPlayerCount(n: number | null | undefined): string {
    if (!n) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

export function scoreColor(n: number | null | undefined): { clr: string; bg: string } | null {
    if (n == null) return null
    if (n >= 75) return { clr: '#4caf50', bg: 'rgba(76,175,80,0.13)' }
    if (n >= 50) return { clr: '#c9a84c', bg: 'rgba(201,168,76,0.13)' }
    return             { clr: '#e05050', bg: 'rgba(224,80,80,0.13)' }
}

// ── News ──────────────────────────────────────────────────────────────────────

const BB_RE = /\[(?:b|i|u|s|h[1-6]|url|img|list|quote|code|spoiler|strike)[=\]]/i

export function newsBBCodeDirty(news: { items?: { contents?: string }[] } | null | undefined): boolean {
    return news?.items?.some(item => BB_RE.test(item.contents ?? '')) ?? false
}
