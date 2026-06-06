import { escapeHtml } from '../utils.js'
import { showContextMenu } from './context-menu.js'
import { loadPrefs, toggleFilter, toggleMute, toggleFavorite, toggleHighlight } from '../community-user-prefs.js'

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

    let game, redditData, prefs
    try {
        const [gameRes, redditRes] = await Promise.all([
            fetch(`/relay/api/games/${appid}`),
            fetch(`/relay/api/reddit/${appid}`),
        ])
        if (!gameRes.ok) throw new Error(`Game HTTP ${gameRes.status}`)
        game = await gameRes.json()
        if (redditRes.ok) {
            redditData = await redditRes.json()
        } else {
            const r2 = await fetch(`/relay/api/reddit/${appid}?name=${encodeURIComponent(game.name ?? '')}`)
            redditData = r2.ok ? await r2.json() : null
        }
        prefs = await loadPrefs(appid)
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    const sources = (redditData?.sources ?? [])
        .filter(s => s.posts?.length > 0)
        .map(s => ({
            id:    s.subreddit,
            label: `r/${s.subreddit}`,
            type:  'reddit',
            posts: s.posts.map(p => ({ ...p, subreddit: p.subreddit ?? s.subreddit })),
        }))

    const totalPosts = sources.reduce((n, s) => n + s.posts.length, 0)

    container.innerHTML = `
        <div class="community-page" data-appid="${escapeHtml(String(appid))}">
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

    _applyAllPrefs(container, prefs)
    _initTabs(container)
    _initNavLinks(container)
    _initUserContextMenus(container, appid)
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

function _thumbSrc(post) {
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.localImage) return `/relay${post.localImage}`
    if (post.thumbnail)  return post.thumbnail
    return null
}

function _imgSrc(post) {
    if (post.localImage) return `/relay${post.localImage}`
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.thumbnail)  return post.thumbnail
    return null
}

function _videoSrc(post) {
    if (post.localVideo) return `/relay${post.localVideo}`
    return null
}

function _postCard(post, appid) {
    const author   = post.author ?? ''
    const score    = _fmtScore(post.score)
    const time     = _fmtTime(post.createdUtc)
    const flair    = post.flair ? `<span class="community-post-flair">${escapeHtml(post.flair)}</span>` : ''
    const body     = post.selftext
        ? `<p class="community-post-body">${escapeHtml(post.selftext)}</p>`
        : ''
    const thumbSrc = _thumbSrc(post)
    const playIcon = post.isVideo ? '<span class="community-post-play">▶</span>' : ''
    const img      = thumbSrc
        ? `<div class="community-post-img-wrap">${playIcon}<img class="community-post-img" src="${thumbSrc}" alt="" loading="lazy" onerror="this.closest('.community-post-img-wrap').remove()"></div>`
        : ''
    const href = `/community/${appid}/thread/${post.id}?sub=${encodeURIComponent(post.subreddit ?? '')}`

    return `
        <a class="community-post-card${thumbSrc ? ' community-post-card--has-image' : ''}" href="${href}" data-nav data-author="${escapeHtml(author)}">
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
                    <span class="community-post-author">u/${escapeHtml(author)}</span>
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
    if (container._communityNavWired) return
    container._communityNavWired = true
    container.addEventListener('click', e => {
        const link = e.target.closest('[data-nav]')
        if (!link) return
        e.preventDefault()
        e.stopPropagation()
        const href = link.getAttribute('href')
        if (!href) return
        import('../router.js').then(m => m.navigate(href.slice(1)))
    })
}

// ── Thread view ───────────────────────────────────────────────────────────────

export async function renderCommunityThread(appid, postId, container, sub = '') {
    if (!sub) sub = new URLSearchParams(window.location.search).get('sub') ?? ''
    container.innerHTML = '<p class="page-loading">Loading…</p>'

    let game, thread, prefs
    try {
        const [gameRes, threadRes] = await Promise.all([
            fetch(`/relay/api/games/${appid}`),
            fetch(`/relay/api/reddit/${appid}/thread/${postId}?sub=${encodeURIComponent(sub)}`),
        ])
        if (!gameRes.ok)   throw new Error(`Game HTTP ${gameRes.status}`)
        if (!threadRes.ok) throw new Error(`Thread HTTP ${threadRes.status}`)
        game   = await gameRes.json()
        thread = await threadRes.json()
        prefs  = await loadPrefs(appid)
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    const post         = thread.post
    const comments     = thread.comments ?? []
    const commentCount = _countComments(comments)

    container.innerHTML = `
        <div class="community-page" data-appid="${escapeHtml(String(appid))}">
            <div class="community-thread-nav">
                <a class="community-back" href="/community/${appid}" data-nav>← Community</a>
            </div>
            <div class="community-thread-post">
                ${_fullPostCard(post, thread.subreddit)}
            </div>
            <div class="community-thread-comments" data-appid="${escapeHtml(String(appid))}" data-post-id="${postId}" data-sub="${escapeHtml(sub)}">
                <div class="community-comments-header">
                    <h2 class="community-comments-heading">${commentCount} Comment${commentCount !== 1 ? 's' : ''}</h2>
                    <button class="community-refresh-btn" title="Fetch latest comments">↻ Refresh</button>
                </div>
                ${comments.length === 0
                    ? '<p class="community-empty">No comments yet.</p>'
                    : comments.map(c => _renderComment(c, post.permalink)).join('')}
            </div>
        </div>`

    _applyAllPrefs(container, prefs)
    _initThread(container)
    _initNavLinks(container)
    _initThreadRefresh(container, prefs)
    _initUserContextMenus(container, appid)
    _initImageLightbox(container)
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
    const videoSrc = _videoSrc(post)
    const imgSrc   = !videoSrc ? _imgSrc(post) : null
    const img      = videoSrc
        ? `<div class="community-thread-post-image"><video class="community-thread-post-video" src="${videoSrc}" controls loop muted playsinline preload="metadata"></video></div>`
        : imgSrc
            ? `<div class="community-thread-post-image" data-lightbox-src="${escapeHtml(imgSrc)}"><img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" onerror="this.closest('.community-thread-post-image').remove()"></div>`
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
    const author    = comment.author ?? ''

    const body    = comment.body
        ? escapeHtml(comment.body)
        : '<em class="thread-comment-deleted">[deleted]</em>'
    const time    = _fmtTime(comment.createdUtc)
    const score   = _fmtScore(comment.score)
    const replies = comment.replies ?? []

    const repliesHtml = replies.length > 0
        ? `<div class="thread-comment-replies" hidden>${replies.map(r => _renderComment(r, threadUrl)).join('')}</div>`
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
            <div class="thread-comment-body">${body}</div>
            ${repliesHtml}
        </div>`
}

// ── Image lightbox ────────────────────────────────────────────────────────────

function _initImageLightbox(container) {
    container.addEventListener('click', e => {
        const wrap = e.target.closest('[data-lightbox-src]')
        if (!wrap) return
        const src = wrap.dataset.lightboxSrc

        const modal = document.createElement('div')
        modal.className = 'community-img-lightbox'
        modal.innerHTML = `<img src="${escapeHtml(src)}" alt="">`

        const close = () => modal.remove()
        modal.addEventListener('click', close)

        const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) } }
        document.addEventListener('keydown', onKey)

        document.body.appendChild(modal)
    })
}

// ── Pref application ──────────────────────────────────────────────────────────

function _applyAllPrefs(container, prefs) {
    container.querySelectorAll('[data-author]').forEach(el => {
        const a = el.dataset.author
        if (!a) return
        el.hidden = prefs.filtered.has(a)
        el.classList.toggle('is-user-muted',        prefs.muted.has(a))
        el.classList.toggle('is-user-favorited',    prefs.favorited.has(a))
        el.classList.toggle('is-user-highlighted',  prefs.highlighted.has(a))
    })
}

// ── User context menu ─────────────────────────────────────────────────────────

function _initUserContextMenus(container, appid) {
    container.addEventListener('contextmenu', e => {
        // Accept right-click anywhere on a post card or comment; author is on data-author
        const target = e.target.closest('[data-author]')
        if (!target) return

        const username = target.dataset.author
        if (!username || username === '[deleted]') return

        // Read live pref state from DOM classes across all elements for this author
        const targets = [...container.querySelectorAll(`[data-author="${CSS.escape(username)}"]`)]
        const first   = targets[0]
        const isFiltered    = first?.hidden ?? false
        const isMuted       = first?.classList.contains('is-user-muted')       ?? false
        const isFavorited   = first?.classList.contains('is-user-favorited')   ?? false
        const isHighlighted = first?.classList.contains('is-user-highlighted') ?? false

        showContextMenu(e, [
            {
                label: isFiltered ? `Remove filter on u/${username}` : `Filter u/${username}`,
                action: () => {
                    const nowOn = !isFiltered
                    targets.forEach(el => { el.hidden = nowOn })
                    toggleFilter(username).catch(console.warn)
                },
            },
            {
                label: isMuted ? `Unmute u/${username}` : `Mute u/${username}`,
                action: () => {
                    const nowOn = !isMuted
                    targets.forEach(el => el.classList.toggle('is-user-muted', nowOn))
                    toggleMute(username).catch(console.warn)
                },
            },
            'separator',
            {
                label: isHighlighted ? `Remove highlight (this game)` : `Highlight u/${username} (this game)`,
                action: () => {
                    const nowOn = !isHighlighted
                    targets.forEach(el => el.classList.toggle('is-user-highlighted', nowOn))
                    toggleHighlight(appid, username).catch(console.warn)
                },
            },
            {
                label: isFavorited ? `Remove favorite on u/${username}` : `Favorite u/${username}`,
                action: () => {
                    const nowOn = !isFavorited
                    targets.forEach(el => el.classList.toggle('is-user-favorited', nowOn))
                    toggleFavorite(username).catch(console.warn)
                },
            },
        ])
    })
}

// ── Thread refresh ────────────────────────────────────────────────────────────

function _initThreadRefresh(container, prefs) {
    const btn = container.querySelector('.community-refresh-btn')
    if (!btn) return
    btn.addEventListener('click', async () => {
        btn.disabled = true
        btn.textContent = '↻ Fetching…'
        const section = container.querySelector('.community-thread-comments')
        const { appid, postId, sub } = section.dataset

        try {
            const res = await fetch(`/relay/api/reddit/${appid}/thread/${postId}?sub=${encodeURIComponent(sub)}&force=true`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const thread      = await res.json()
            const newComments = thread.comments ?? []

            const existing = new Set(
                [...section.querySelectorAll('.thread-comment[data-id]')].map(el => el.dataset.id)
            )

            const added = []
            for (const c of newComments) {
                if (!existing.has(c.id)) {
                    const tmp = document.createElement('div')
                    tmp.innerHTML = _renderComment(c, thread.post?.permalink ?? '')
                    const el = tmp.firstElementChild
                    if (el) { section.appendChild(el); added.push(c.id) }
                }
            }

            const allNew  = _flattenComments(newComments)
            const scoreMap = new Map(allNew.map(c => [c.id, c.score]))
            section.querySelectorAll('.thread-comment[data-id]').forEach(el => {
                const s = scoreMap.get(el.dataset.id)
                if (s == null) return
                const scoreEl = el.querySelector('.thread-comment-score')
                if (scoreEl) scoreEl.textContent = `▲ ${_fmtScore(s)}`
            })

            const total = _countComments(newComments)
            const heading = section.querySelector('.community-comments-heading')
            if (heading) heading.textContent = `${total} Comment${total !== 1 ? 's' : ''}`

            section.querySelectorAll('.thread-comment-toggle').forEach(b => {
                if (b.dataset.wired) return
                b.dataset.wired = '1'
                b.addEventListener('click', () => {
                    const comment = b.closest('.thread-comment')
                    const replies = comment?.querySelector('.thread-comment-replies')
                    if (!replies) return
                    const nowHidden = replies.toggleAttribute('hidden')
                    b.textContent = nowHidden ? '+' : '−'
                    b.setAttribute('aria-label', nowHidden ? 'Expand replies' : 'Collapse replies')
                })
            })

            // Apply current prefs to any newly injected comment elements
            if (added.length > 0) _applyAllPrefs(section, prefs)

            btn.textContent = added.length > 0
                ? `↻ +${added.length} new`
                : '↻ Up to date'
        } catch (err) {
            btn.textContent = '↻ Failed'
            console.warn('[thread-refresh]', err)
        } finally {
            btn.disabled = false
            setTimeout(() => { if (btn.isConnected) btn.textContent = '↻ Refresh' }, 3000)
        }
    })
}

function _flattenComments(comments) {
    const out = []
    for (const c of comments) { out.push(c); out.push(..._flattenComments(c.replies ?? [])) }
    return out
}

function _initThread(container) {
    container.querySelectorAll('.thread-comment-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const comment = btn.closest('.thread-comment')
            if (!comment) return
            const replies = comment.querySelector('.thread-comment-replies')
            if (!replies) return
            const nowHidden = replies.toggleAttribute('hidden')
            btn.textContent = nowHidden ? '+' : '−'
            btn.setAttribute('aria-label', nowHidden ? 'Expand replies' : 'Collapse replies')
        })
    })
}
