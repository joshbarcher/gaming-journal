// Ported verbatim from src/lib/js/views/community-render.ts.
import type { RedditComment, RedditPost } from 'gaming-journal-contracts/reddit'

export function fmtScore(n: number | null | undefined): string {
    if (n == null) return '0'
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
}

export function fmtTime(utc: number | null | undefined): string {
    if (!utc) return ''
    const diff = Math.floor((Date.now() / 1000) - utc)
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
    return new Date(utc * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// `local*` fields are relay-relative ("/images/reddit/subreddits/.../x_thumb.jpg") — the web's own
// thumbSrc()/imgSrc()/videoSrc() explicitly prepend `/relay` to these (same gateway-routing
// convention as every other relay-served image in this app), confirmed live: fetching the bare
// path directly against the gateway 404s, only the `/relay`-prefixed one 200s. `thumbnail`/`url`-
// derived fields are, separately, ALREADY-ABSOLUTE external CDN URLs (e.g.
// `https://external-preview.redd.it/...`) — same "two conventions for one field" gotcha already
// found in Discover's headerImage. `thumbPath`/`imgPath`/`videoPath` below return the `/relay`-
// prefixed form for local fields so resolveMediaUrl()'s single startsWith('http') check works
// uniformly for both.
export function resolveMediaUrl(path: string | null | undefined, apiHost: string | undefined): string | null {
    if (!path) return null
    if (path.startsWith('http')) return path
    return apiHost ? `${apiHost}${path}` : null
}

export function thumbPath(post: RedditPost): string | null {
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.localImage) return `/relay${post.localImage}`
    if (post.thumbnail) return post.thumbnail
    const g = post.galleryImages?.[0]
    if (g?.localImage) return `/relay${g.localImage}`
    if (g?.thumbnail) return g.thumbnail ?? null
    return null
}

export function imgPath(post: RedditPost): string | null {
    if (post.localImage) return `/relay${post.localImage}`
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.thumbnail) return post.thumbnail
    return null
}

export function videoPath(post: RedditPost): string | null {
    return post.localVideo ? `/relay${post.localVideo}` : null
}

// Shared helper for comment/gallery images and gifs, all of which carry the same
// `{localImage?|localVideo?, url?}` local-vs-absolute split as post-level fields above.
export function resolveLocalOrUrl(local: string | null | undefined, url: string | null | undefined, apiHost: string | undefined): string | null {
    return resolveMediaUrl(local ? `/relay${local}` : (url ?? null), apiHost)
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
