// Ported verbatim from src/lib/js/views/game-render.ts — the game detail page's own formatting
// rules, genuinely different from other screens' number formatting (e.g. this fmtHours takes
// HOURS directly with its own tiering, unlike utils/format.ts's minutes-based formatPlaytime or
// franchises' fmtHours which takes minutes too).
import type { GameStore } from 'gaming-journal-contracts/gameDetail'

export function releaseStatus(store: GameStore | null | undefined): string {
    if (!store || store.unavailable) return 'unknown'
    if ((store.categories ?? []).includes('Early Access')) return 'early_access'
    const dateStr = (store.releaseDate ?? '').trim()
    if (!dateStr) return 'unknown'
    const lower = dateStr.toLowerCase()
    if (['coming soon', 'to be announced', 'tba', 'tbd'].includes(lower)) return 'coming_soon'
    if (/^q[1-4]\s*\d{4}$/i.test(dateStr)) return 'coming_soon'
    if (/^\d{4}$/.test(dateStr)) return parseInt(dateStr, 10) > new Date().getFullYear() ? 'coming_soon' : 'released'
    const parsed = new Date(dateStr)
    if (!isNaN(parsed.getTime())) return parsed > new Date() ? 'coming_soon' : 'released'
    return 'unknown'
}

export function fmtHours(h: number | null | undefined): string {
    if (h == null) return '—'
    if (h >= 100) return `${Math.round(h)}h`
    if (h >= 10) return `${Math.round(h * 2) / 2}h`
    return `${Math.round(h * 10) / 10}h`
}

export function fmtCount(n: number | null | undefined): string {
    if (n == null) return '0'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
}

export function scoreColor(n: number | null | undefined): { clr: string; bg: string } | null {
    if (n == null) return null
    if (n >= 75) return { clr: '#4caf50', bg: 'rgba(76,175,80,0.13)' }
    if (n >= 50) return { clr: '#c9a84c', bg: 'rgba(201,168,76,0.13)' }
    return { clr: '#e05050', bg: 'rgba(224,80,80,0.13)' }
}

// Keep in sync with web src/lib/js/views/game-render.ts — the attribute run before `]`/`=`
// catches Steam's attribute-form tags ([img src="…"], [dynamiclink href="…"]) too.
const BB_RE = /\[(?:b|i|u|s|h[1-6]|url|img|list|olist|quote|code|spoiler|strike|dynamiclink|previewyoutube)(?:\s|=|\])/i
export function newsBBCodeDirty(news: { items?: { contents?: string }[] } | null | undefined): boolean {
    return news?.items?.some(item => BB_RE.test(item.contents ?? '')) ?? false
}

// Plain-text HTML stripper — a deliberate, documented simplification. Real rich rendering
// (bold/lists/tables) is deferred to Phase 3's ContentBlockRenderer (react-native-render-html
// wrapper, per PLAN.md); introducing that dependency mid-way through this already-large screen
// risked destabilizing everything else in it. About/News/PCGW fixes all use this for now — revisit
// once ContentBlockRenderer exists and retrofit all three call sites together.
export function stripHtml(html: string | null | undefined): string {
    if (!html) return ''
    return html
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}
