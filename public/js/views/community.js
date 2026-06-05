import { escapeHtml } from '../utils.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmtScore(n) {
    if (n == null) return '0'
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
}

function _fmtTime(utc) {
    if (!utc) return ''
    const diff = Math.floor((Date.now() / 1000) - utc)
    if (diff < 3600)           return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400)          return `${Math.floor(diff / 3600)}h ago`
    if (diff < 86400 * 30)     return `${Math.floor(diff / 86400)}d ago`
    return new Date(utc * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// ── Community listing ─────────────────────────────────────────────────────────

export async function renderCommunity(appid, container) {
    container.innerHTML = '<p class="page-loading">Loading…</p>'

    let game, redditData
    try {
        const [gameRes, redditRes] = await Promise.all([
            fetch(`/relay/api/games/${appid}`),
            fetch(`/relay/api/reddit/${appid}`),
        ])
        if (!gameRes.ok) throw new Error(`Game HTTP ${gameRes.status}`)
        game = await gameRes.json()
        // If reddit data is not yet cached, fetch with name
        if (redditRes.ok) {
            redditData = await redditRes.json()
        } else {
            const r2 = await fetch(`/relay/api/reddit/${appid}?name=${encodeURIComponent(game.name ?? '')}`)
            redditData = r2.ok ? await r2.json() : null
        }
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    // Build sources array — generic abstraction (Reddit now, Steam community later)
    const sources = (redditData?.sources ?? [])
        .filter(s => s.posts?.length > 0)
        .map(s => ({
            id:    s.subreddit,
            label: `r/${s.subreddit}`,
            type:  'reddit',
            posts: s.posts.slice(0, 5).map(p => ({ ...p, subreddit: p.subreddit ?? s.subreddit })),
        }))

    const totalPosts = sources.reduce((n, s) => n + s.posts.length, 0)

    container.innerHTML = `
        <div class="community-page">
            <div class="community-header">
                <div class="community-header-body">
                    <a class="community-back" href="/game/${appid}" data-nav>← ${escapeHtml(game.name ?? 'Game')}</a>
                    <p class="community-eyebrow">Community</p>
                    <h1 class="community-title">${escapeHtml(game.name ?? '')}</h1>
                    <p class="community-subtitle">${totalPosts} post${totalPosts !== 1 ? 's' : ''} from Reddit</p>
                </div>
            </div>
            <div class="community-body">
                ${sources.length === 0 ? _emptyState() : _sourceTabs(sources, appid)}
            </div>
        </div>`

    _initTabs(container)
    _initNavLinks(container)
}

function _emptyState() {
    return '<p class="community-empty">No community posts found for this game.</p>'
}

function _sourceTabs(sources, appid) {
    const tabs = sources.map((s, i) => `
        <button class="community-tab${i === 0 ? ' community-tab--active' : ''}" data-source="${escapeHtml(s.id)}">
            ${escapeHtml(s.label)}
            <span class="community-tab-count">${s.posts.length}</span>
        </button>`).join('')

    const panels = sources.map((s, i) => `
        <div class="community-panel${i === 0 ? ' community-panel--active' : ''}" data-source="${escapeHtml(s.id)}">
            ${s.posts.length === 0
                ? '<p class="community-empty">No posts found.</p>'
                : s.posts.map(p => _postCard(p, appid)).join('')}
        </div>`).join('')

    return `
        <div class="community-tabs">${tabs}</div>
        <div class="community-panels">${panels}</div>`
}

// For post listing cards: prefer cached thumbnail, fall back to cached full image
function _thumbSrc(post) {
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.localImage) return `/relay${post.localImage}`
    if (post.thumbnail)  return post.thumbnail   // CDN fallback (may expire)
    return null
}

// For thread view: prefer full cached image, fall back to thumbnail
function _imgSrc(post) {
    if (post.localImage) return `/relay${post.localImage}`
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.thumbnail)  return post.thumbnail
    return null
}

function _postCard(post, appid) {
    const score    = _fmtScore(post.score)
    const time     = _fmtTime(post.createdUtc)
    const flair    = post.flair ? `<span class="community-post-flair">${escapeHtml(post.flair)}</span>` : ''
    const body     = post.selftext
        ? `<p class="community-post-body">${escapeHtml(post.selftext)}</p>`
        : ''
    const thumbSrc = _thumbSrc(post)
    const img      = thumbSrc
        ? `<div class="community-post-img-wrap"><img class="community-post-img" src="${thumbSrc}" alt="" loading="lazy" onerror="this.closest('.community-post-img-wrap').remove()"></div>`
        : ''
    const href = `/community/${appid}/thread/${post.id}?sub=${encodeURIComponent(post.subreddit ?? '')}`

    return `
        <a class="community-post-card${thumbSrc ? ' community-post-card--has-image' : ''}" href="${href}" data-nav>
            ${img}
            <div class="community-post-content">
                <div class="community-post-header">
                    ${flair}
                    <span class="community-post-title">${escapeHtml(post.title)}</span>
                </div>
                ${body}
                <div class="community-post-meta">
                    <span class="community-post-score">▲ ${escapeHtml(score)}</span>
                    <span class="community-post-comments">💬 ${(post.numComments ?? 0).toLocaleString()}</span>
                    <span class="community-post-author">u/${escapeHtml(post.author ?? '')}</span>
                    <span class="community-post-sub">r/${escapeHtml(post.subreddit ?? '')}</span>
                    <span class="community-post-time">${escapeHtml(time)}</span>
                </div>
            </div>
        </a>`
}

function _initTabs(container) {
    container.querySelectorAll('.community-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const src = btn.dataset.source
            container.querySelectorAll('.community-tab').forEach(b =>
                b.classList.toggle('community-tab--active', b.dataset.source === src))
            container.querySelectorAll('.community-panel').forEach(p =>
                p.classList.toggle('community-panel--active', p.dataset.source === src))
        })
    })
}

function _initNavLinks(container) {
    container.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault()
            const href = el.getAttribute('href')
            if (!href) return
            import('../router.js').then(m => m.navigate(href.slice(1)))
        })
    })
}

// ── Thread view ───────────────────────────────────────────────────────────────

export async function renderCommunityThread(appid, postId, container) {
    container.innerHTML = '<p class="page-loading">Loading…</p>'

    const params    = new URLSearchParams(window.location.search)
    const sub       = params.get('sub') ?? ''

    let game, thread
    try {
        const [gameRes, threadRes] = await Promise.all([
            fetch(`/relay/api/games/${appid}`),
            fetch(`/relay/api/reddit/${appid}/thread/${postId}?sub=${encodeURIComponent(sub)}`),
        ])
        if (!gameRes.ok)   throw new Error(`Game HTTP ${gameRes.status}`)
        if (!threadRes.ok) throw new Error(`Thread HTTP ${threadRes.status}`)
        game   = await gameRes.json()
        thread = await threadRes.json()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    const post         = thread.post
    const comments     = thread.comments ?? []
    const commentCount = _countComments(comments)

    container.innerHTML = `
        <div class="community-page">
            <div class="community-thread-nav">
                <a class="community-back" href="/community/${appid}" data-nav>← Community</a>
            </div>
            <div class="community-thread-post">
                ${_fullPostCard(post, thread.subreddit)}
            </div>
            <div class="community-thread-comments">
                <h2 class="community-comments-heading">${commentCount} Comment${commentCount !== 1 ? 's' : ''}</h2>
                ${comments.length === 0
                    ? '<p class="community-empty">No comments yet.</p>'
                    : comments.map(c => _renderComment(c, post.permalink)).join('')}
            </div>
        </div>`

    _initThread(container)
    _initNavLinks(container)
}

function _countComments(comments) {
    let n = 0
    for (const c of comments) {
        n += 1 + _countComments(c.replies ?? [])
    }
    return n
}

function _fullPostCard(post, subreddit) {
    const score    = _fmtScore(post.score)
    const time     = _fmtTime(post.createdUtc)
    const flair    = post.flair ? `<span class="community-post-flair">${escapeHtml(post.flair)}</span>` : ''
    const body     = post.selftext
        ? `<div class="community-thread-post-body">${escapeHtml(post.selftext)}</div>`
        : ''
    const imgSrc   = _imgSrc(post)
    const img      = imgSrc
        ? `<div class="community-thread-post-image"><img src="${imgSrc}" alt="" loading="lazy" onerror="this.closest('.community-thread-post-image').remove()"></div>`
        : ''

    return `
        <div class="community-thread-post-card">
            <div class="community-post-header">
                ${flair}
                <span class="community-post-title community-post-title--large">${escapeHtml(post.title)}</span>
            </div>
            ${img}
            ${body}
            <div class="community-post-meta">
                <span class="community-post-score">▲ ${escapeHtml(score)}</span>
                <span class="community-post-comments">💬 ${(post.numComments ?? 0).toLocaleString()}</span>
                <span class="community-post-author">u/${escapeHtml(post.author ?? '')}</span>
                <span class="community-post-sub">r/${escapeHtml(subreddit ?? post.subreddit ?? '')}</span>
                <span class="community-post-time">${escapeHtml(time)}</span>
                <a class="community-post-reddit-link" href="${escapeHtml(post.permalink)}" target="_blank" rel="noopener noreferrer">View on Reddit ↗</a>
            </div>
        </div>`
}

function _renderComment(comment, threadUrl, depth = 0) {
    if (!comment) return ''
    const usedDepth = comment.depth ?? depth

    if (usedDepth >= 5) {
        return `
            <div class="thread-comment thread-comment--continue" data-depth="${usedDepth}">
                <a class="thread-comment-continue" href="${escapeHtml(threadUrl)}" target="_blank" rel="noopener noreferrer">Continue thread →</a>
            </div>`
    }

    const body    = comment.body
        ? escapeHtml(comment.body)
        : '<em class="thread-comment-deleted">[deleted]</em>'
    const time    = _fmtTime(comment.createdUtc)
    const score   = _fmtScore(comment.score)
    const replies = comment.replies ?? []

    const repliesHtml = replies.length > 0
        ? `<div class="thread-comment-replies">${replies.map(r => _renderComment(r, threadUrl)).join('')}</div>`
        : ''

    const toggleBtn = replies.length > 0
        ? `<button class="thread-comment-toggle" aria-label="Collapse comment">−</button>`
        : ''

    return `
        <div class="thread-comment" data-depth="${usedDepth}">
            <div class="thread-comment-header">
                ${toggleBtn}
                <span class="thread-comment-author">${escapeHtml(comment.author ?? '[deleted]')}</span>
                <span class="thread-comment-score">▲ ${escapeHtml(score)}</span>
                <span class="thread-comment-time">${escapeHtml(time)}</span>
            </div>
            <div class="thread-comment-body">${body}</div>
            ${repliesHtml}
        </div>`
}

function _initThread(container) {
    container.querySelectorAll('.thread-comment-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const comment = btn.closest('.thread-comment')
            if (!comment) return
            const collapsed = comment.classList.toggle('thread-comment--collapsed')
            btn.textContent = collapsed ? '+' : '−'
        })
    })
}
