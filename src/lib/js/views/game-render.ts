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

// Steam news `contents` is mostly HTML, but some feeds leak raw Steam BBCode — both the
// classic form ([img]url[/img]) and an attribute form ([img src="url"][/img], [dynamiclink
// href="url"][/dynamiclink]). The relay converts most of it server-side; `newsBBCodeDirty`
// still triggers a refresh when it sees any, but attribute-form tags slip past a simple
// [tag] check, so the regex allows an optional attribute run before the `]`/`=`.
const BB_RE = /\[(?:b|i|u|s|h[1-6]|url|img|list|olist|quote|code|spoiler|strike|dynamiclink|previewyoutube)(?:\s|=|\])/i

export function newsBBCodeDirty(news: { items?: { contents?: string }[] } | null | undefined): boolean {
    return news?.items?.some(item => BB_RE.test(item.contents ?? '')) ?? false
}

// Client-side backstop: convert leftover Steam BBCode to HTML so raw tags never bleed into
// the rendered news panel, regardless of what the relay served. Only known Steam tags are
// touched — genuine bracketed prose like "[Patch Notice]" is left intact.
// URLs captured from BBCode land inside href/src attributes — escape quote/angle
// characters so a crafted news post ([img]x" onerror="…[/img]) can't break out of
// the attribute and inject live handlers.
function escAttr(url: string): string {
    return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderNewsHtml(raw: string | null | undefined): string {
    if (!raw) return ''
    let s = raw

    // {STEAM_CLAN_IMAGE} / {STEAM_CLAN_LOC_IMAGE} tokens → CDN host
    s = s.replace(/\{STEAM_CLAN(?:_LOC)?_IMAGE\}/g, 'https://clan.akamai.steamstatic.com/images')

    // Images — attribute form [img src="url"][/img] and classic [img]url[/img]
    s = s.replace(/\[img\s+src=["']?([^"'\]]+)["']?\s*\]\s*(?:\[\/img\])?/gi,
        (_m, url) => `<img src="${escAttr(url.trim())}" loading="lazy">`)
    s = s.replace(/\[img\]([\s\S]*?)\[\/img\]/gi,
        (_m, url) => `<img src="${escAttr(url.trim())}" loading="lazy">`)

    // Dynamic store links [dynamiclink href="url"][/dynamiclink] → plain link
    s = s.replace(/\[dynamiclink\s+href=["']?([^"'\]]+)["']?\s*\]\s*(?:\[\/dynamiclink\])?/gi,
        (_m, url) => `<a href="${escAttr(url.trim())}" target="_blank" rel="noopener noreferrer">${escAttr(url.trim())}</a>`)

    // Links [url=url]text[/url] and [url]url[/url]
    s = s.replace(/\[url=["']?([^"'\]]+)["']?\]([\s\S]*?)\[\/url\]/gi,
        (_m, url, text) => `<a href="${escAttr(url.trim())}" target="_blank" rel="noopener noreferrer">${text}</a>`)
    s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi,
        (_m, url) => `<a href="${escAttr(url.trim())}" target="_blank" rel="noopener noreferrer">${escAttr(url.trim())}</a>`)

    // YouTube preview [previewyoutube=ID;flags][/previewyoutube] → link
    s = s.replace(/\[previewyoutube=([\w-]+)[^\]]*\]\s*(?:\[\/previewyoutube\])?/gi,
        (_m, id) => `<a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">▶ Watch on YouTube</a>`)

    // Headings — Steam h1/h2 map to the panel's h3, h3 to h4 (h1/h2 reserved for page/section)
    s = s.replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h3>$1</h3>')
    s = s.replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h3>$1</h3>')
    s = s.replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h4>$1</h4>')

    // Inline styling
    s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
    s = s.replace(/\[(?:s|strike)\]([\s\S]*?)\[\/(?:s|strike)\]/gi, '<s>$1</s>')

    // Lists — items first (so the [*] capture stops at the [/list] bracket), then wrappers
    s = s.replace(/\[\*\]\s*([^\[\n]*)/gi, '<li>$1</li>')
    s = s.replace(/\[\/(?:list|olist)\]/gi, '</ul>')
    s = s.replace(/\[(?:list|olist)\]/gi, '<ul>')

    // Quotes / code
    s = s.replace(/\[quote(?:=[^\]]*)?\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>')
    s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<pre>$1</pre>')

    // Drop any remaining known Steam tags we don't render (spoiler/noparse/tables/hr/…)
    s = s.replace(/\[\/?(?:spoiler|noparse|table|tr|td|th|hr)[^\]]*\]/gi, '')

    // Steam sprinkles a lone backslash (as its own paragraph, sometimes wrapped in [b]) to
    // force a blank spacer line. Drop the stray backslash but keep the surrounding empty
    // element / line so the intended spacing survives.
    s = s.replace(/(>)\s*\\+\s*(<)/g, '$1$2')
    s = s.replace(/^[ \t]*\\+[ \t]*$/gm, '')

    return s
}
