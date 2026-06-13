import { escapeHtml } from '../utils.js'
import type {
    RedditPost,
    RedditComment,
    RedditCommentImage,
    RedditCommentGif,
    RedditImgurEntry,
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

export function renderSubredditLoader(msg: string): string {
    return `
        <div class="community-sync-wrap">
            <div class="community-loader"></div>
            <p class="community-sync-status">${escapeHtml(msg)}</p>
            <div class="community-sync-bar"><div class="community-sync-bar-fill"></div></div>
        </div>`
}

export function renderComment(comment: RedditComment | null | undefined, threadUrl: string, depth = 0): string {
    if (!comment) return ''
    const usedDepth = comment.depth ?? depth
    const author    = comment.author ?? ''

    const rawBody = comment.body ?? null
    const displayBody = rawBody
        ? rawBody
            .replace(/https?:\/\/(?:preview|i)\.redd\.it\/\S+\.(?:png|jpe?g|gif|webp)\S*/gi, '')
            .replace(/!\[gif\]\(giphy\|[a-zA-Z0-9]+[^)]*\)/gi, '')
            .replace(/\[[^\]]*\]\(https?:\/\/(?:i\.)?imgur\.com\/[^)]+\)/gi, '')
            .replace(/https?:\/\/(?:i\.)?imgur\.com\/\S+/gi, '')
            .trim()
        : null

    const images = comment.images ?? []
    const gifs   = comment.gifs   ?? []
    const imgur  = (comment.imgur ?? []).filter(e => e.images?.length && !e.failed)

    const bodyHtml = displayBody
        ? escapeHtml(displayBody)
        : images.length === 0
            ? '<em class="thread-comment-deleted">[deleted]</em>'
            : ''

    const imagesHtml = images.map(img => {
        const src = img.localImage ? `/relay${img.localImage}` : img.url
        return `<div class="thread-comment-image" data-lightbox-src="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.closest('.thread-comment-image').remove()"></div>`
    }).join('')

    const gifsHtml = gifs.filter(g => g.localVideo).map(g => {
        const src = `/relay${g.localVideo}`
        return `<div class="thread-comment-gif"><video src="${escapeHtml(src)}" autoplay loop muted playsinline></video></div>`
    }).join('')

    const imgurHtml = imgur.map(entry => {
        const first = entry.images[0]
        const src   = first.localImage ? `/relay${first.localImage}` : first.url
        if (entry.images.length === 1) {
            return `<div class="thread-comment-image" data-lightbox-src="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.closest('.thread-comment-image').remove()"></div>`
        }
        const srcs = entry.images.map(img => img.localImage ? `/relay${img.localImage}` : img.url)
        return `<div class="thread-comment-imgur-album" data-carousel="${escapeHtml(JSON.stringify(srcs))}">
            <img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.closest('.thread-comment-imgur-album').remove()">
            <span class="thread-comment-album-badge">+${entry.images.length - 1} more</span>
        </div>`
    }).join('')

    const time    = fmtTime(comment.createdUtc)
    const score   = fmtScore(comment.score)
    const replies = comment.replies ?? []

    const repliesHtml = replies.length > 0
        ? `<div class="thread-comment-replies" hidden>${replies.map(r => renderComment(r, threadUrl)).join('')}</div>`
        : ''

    const toggleBtn = replies.length > 0
        ? `<button class="thread-comment-toggle" aria-label="Expand replies">+</button>`
        : ''

    return `
        <div class="thread-comment" data-depth="${usedDepth}" data-id="${escapeHtml(comment.id ?? '')}" data-author="${escapeHtml(author)}">
            <div class="thread-comment-header">
                ${toggleBtn}
                <span class="thread-comment-author">${escapeHtml(author || '[deleted]')}</span>
                <span class="thread-comment-score">▲ ${escapeHtml(score)}</span>
                <span class="thread-comment-time">${escapeHtml(time)}</span>
            </div>
            <div class="thread-comment-body">${bodyHtml}</div>
            ${imagesHtml}
            ${gifsHtml}
            ${imgurHtml}
            ${repliesHtml}
        </div>`
}
