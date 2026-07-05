// Ported verbatim from GuidesModal.svelte's guideIdFromUrl() — derives the same guideId a
// downloaded guide is stored/looked-up under from a raw search-result URL, per source's own
// URL shape (steamcommunity id param, fandom subdomain+article, neoseeker walkthrough slug,
// gamefaqs faqs id, ign wiki slug, game8 games slug, gamerguides slug).
export function guideIdFromUrl(url: string): string | null {
    try {
        const u = new URL(url)
        if (u.hostname.includes('steamcommunity.com')) return u.searchParams.get('id')
        if (u.hostname.endsWith('.fandom.com')) {
            const sub = u.hostname.split('.')[0]
            const article = decodeURIComponent(u.pathname.replace(/^\/wiki\//, ''))
            if (article) return `${sub}--${article.replace(/ /g, '_')}`
        }
        if (u.hostname.includes('neoseeker.com')) {
            return u.pathname.match(/\/([a-z0-9-]+)\/walkthrough/i)?.[1] ?? null
        }
    } catch { /* fall through to the plain-regex fallbacks below */ }
    return url.match(/\/faqs\/(\d+)/)?.[1]
        ?? url.match(/ign\.com\/wikis\/([^/?#]+)/i)?.[1]?.toLowerCase()
        ?? url.match(/game8\.co\/games\/([A-Za-z0-9-]+)/i)?.[1]
        ?? url.match(/gamerguides\.com\/([^/?#]+)/i)?.[1]
        ?? null
}
