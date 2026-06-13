import type {
    RedditPost,
    RedditComment,
} from '../../types.js'

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtScore(n: number | null | undefined): string {
    if (n == null) return '0'
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
}

export function fmtTime(utc: number | null | undefined): string {
    if (!utc) return ''
    const diff = Math.floor((Date.now() / 1000) - utc)
    if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400)      return `${Math.floor(diff / 3600)}h ago`
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
    return new Date(utc * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export function thumbSrc(post: RedditPost): string | null {
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.localImage) return `/relay${post.localImage}`
    if (post.thumbnail)  return post.thumbnail
    const g = post.galleryImages?.[0]
    if (g?.localImage) return `/relay${g.localImage}`
    if (g?.thumbnail)  return g.thumbnail ?? null
    return null
}

export function imgSrc(post: RedditPost): string | null {
    if (post.localImage) return `/relay${post.localImage}`
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.thumbnail)  return post.thumbnail
    return null
}

export function videoSrc(post: RedditPost): string | null {
    return post.localVideo ? `/relay${post.localVideo}` : null
}

export function countComments(comments: RedditComment[]): number {
    let n = 0
    for (const c of comments) n += 1 + countComments(c.replies ?? [])
    return n
}

export function flattenComments(comments: RedditComment[]): RedditComment[] {
    const out: RedditComment[] = []
    for (const c of comments) { out.push(c); out.push(...flattenComments(c.replies ?? [])) }
    return out
}

