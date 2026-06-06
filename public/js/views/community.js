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

    let game, redditData, userSubs, prefs
    try {
        const [gameRes, redditRes, userSubsRes] = await Promise.all([
            fetch(`/relay/api/games/${appid}`),
            fetch(`/relay/api/reddit/${appid}`),
            fetch(`/api/reddit-subreddits/${appid}`),
        ])
        if (!gameRes.ok) throw new Error(`Game HTTP ${gameRes.status}`)
        game     = await gameRes.json()
        userSubs = userSubsRes.ok ? await userSubsRes.json() : []
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
                ${sources.length === 0 && userSubs.length === 0
                    ? _emptyState(appid, game.name ?? '', userSubs)
                    : _sourceTabs(sources, appid, game.name ?? '', userSubs)}
            </div>
        </div>`

    _applyAllPrefs(container, prefs)
    _initTabs(container)
    _initNavLinks(container)
    _initUserContextMenus(container, appid)
    _initManagePanel(container, appid, game.name ?? '', userSubs)
}

function _emptyState(appid, gameName, userSubs) {
    return `
        <p class="community-empty">No community posts found for this game.</p>
        <div class="community-empty-manage">
            <button class="community-manage-toggle">⚙ Manage Subreddits</button>
        </div>`
}

function _allSource(sources) {
    const seen  = new Set()
    const posts = []
    for (const s of sources) {
        for (const p of s.posts) {
            if (!seen.has(p.id)) { seen.add(p.id); posts.push(p) }
        }
    }
    posts.sort((a, b) => (b.createdUtc ?? 0) - (a.createdUtc ?? 0))
    return { id: '__all__', label: 'All', posts }
}

function _sourceTabs(sources, appid, gameName, userSubs) {
    const allSrc  = _allSource(sources)
    const display = [allSrc, ...sources]

    const tabs = display.map((s, i) => `
        <button class="community-tab${i === 0 ? ' community-tab--active' : ''}" data-source="${escapeHtml(s.id)}">
            ${escapeHtml(s.label)}
            <span class="community-tab-count">${s.posts.length}</span>
        </button>`).join('')

    const panels = display.map((s, i) => `
        <div class="community-panel${i === 0 ? ' community-panel--active' : ''}" data-source="${escapeHtml(s.id)}">
            ${s.posts.length === 0
                ? '<p class="community-empty">No posts found.</p>'
                : s.posts.map(p => _postCard(p, appid)).join('')}
        </div>`).join('')

    return `
        <div class="community-tabs-bar">
            <div class="community-tabs">${tabs}</div>
            <button class="community-manage-toggle" title="Manage subreddits">⚙ Subreddits</button>
        </div>
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

function _buildManageModal(appid, gameName, userSubs) {
    const modal = document.createElement('div')
    modal.className = 'community-manage-modal'

    const chips = userSubs.map(name => {
        const chip = document.createElement('span')
        chip.className   = 'community-manage-chip'
        chip.dataset.sub = name
        chip.innerHTML   = `r/${escapeHtml(name)} <button class="community-manage-chip-remove" aria-label="Remove r/${escapeHtml(name)}">×</button>`
        return chip
    })

    modal.innerHTML = `
        <div class="community-manage-dialog">
            <div class="community-manage-dialog-header">
                <p class="community-manage-label">Subreddits</p>
                <button class="community-manage-close" aria-label="Close">×</button>
            </div>
            <div class="community-manage-chips"></div>
            <div class="community-manage-add-row">
                <span class="community-manage-prefix">r/</span>
                <input class="community-manage-input" type="text" placeholder="subreddit name" autocomplete="off" spellcheck="false">
                <button class="community-manage-add-btn" disabled>Add</button>
            </div>
            <p class="community-manage-status"></p>
        </div>`

    const chipsEl = modal.querySelector('.community-manage-chips')
    if (chips.length === 0) {
        chipsEl.innerHTML = '<span class="community-manage-none">None added yet</span>'
    } else {
        chips.forEach(c => chipsEl.appendChild(c))
    }

    // Close handlers
    const close = () => modal.remove()
    modal.addEventListener('click', e => { if (e.target === modal) close() })
    modal.querySelector('.community-manage-close').addEventListener('click', close)
    const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) } }
    document.addEventListener('keydown', onKey)

    // Remove chip
    chipsEl.addEventListener('click', async e => {
        const removeBtn = e.target.closest('.community-manage-chip-remove')
        if (!removeBtn) return
        const chip = removeBtn.closest('.community-manage-chip')
        const name = chip?.dataset.sub
        if (!name) return
        removeBtn.disabled = true
        try {
            await fetch(`/api/reddit-subreddits/${appid}/${encodeURIComponent(name)}`, { method: 'DELETE' })
            chip.remove()
            if (!chipsEl.querySelector('.community-manage-chip')) {
                chipsEl.innerHTML = '<span class="community-manage-none">None added yet</span>'
            }
            _triggerResync(appid, gameName)
        } catch { removeBtn.disabled = false }
    })

    // Validation
    const input    = modal.querySelector('.community-manage-input')
    const status   = modal.querySelector('.community-manage-status')
    const addBtn   = modal.querySelector('.community-manage-add-btn')
    let _validName = null
    let _debounce  = null

    input.addEventListener('input', () => {
        clearTimeout(_debounce)
        _validName      = null
        addBtn.disabled = true
        const val = input.value.trim().replace(/^r\//i, '')
        if (!val) { status.textContent = ''; status.className = 'community-manage-status'; return }
        status.textContent = '…'
        status.className   = 'community-manage-status community-manage-status--loading'
        _debounce = setTimeout(async () => {
            try {
                const res  = await fetch(`/relay/api/reddit/validate-subreddit?name=${encodeURIComponent(val)}`)
                const data = await res.json()
                if (data.valid) {
                    _validName         = data.name
                    addBtn.disabled    = false
                    status.textContent = `✓ ${data.name} · ${(data.subscribers ?? 0).toLocaleString()} members`
                    status.className   = 'community-manage-status community-manage-status--valid'
                } else {
                    status.textContent = '✗ Not found'
                    status.className   = 'community-manage-status community-manage-status--invalid'
                }
            } catch {
                status.textContent = '✗ Check failed'
                status.className   = 'community-manage-status community-manage-status--invalid'
            }
        }, 600)
    })

    // Add
    addBtn.addEventListener('click', async () => {
        if (!_validName) return
        addBtn.disabled = true
        try {
            await fetch(`/api/reddit-subreddits/${appid}`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ name: _validName }),
            })
            const noneEl = chipsEl.querySelector('.community-manage-none')
            if (noneEl) noneEl.remove()
            const chip = document.createElement('span')
            chip.className   = 'community-manage-chip'
            chip.dataset.sub = _validName
            chip.innerHTML   = `r/${escapeHtml(_validName)} <button class="community-manage-chip-remove" aria-label="Remove r/${escapeHtml(_validName)}">×</button>`
            chipsEl.appendChild(chip)

            input.value        = ''
            status.textContent = ''
            status.className   = 'community-manage-status'
            _validName         = null
            _triggerResync(appid, gameName)
        } catch { addBtn.disabled = false }
    })

    return modal
}

function _initManagePanel(container, appid, gameName, userSubs) {
    const toggleBtn = container.querySelector('.community-manage-toggle')
    if (!toggleBtn) return

    toggleBtn.addEventListener('click', () => {
        toggleBtn.classList.add('community-manage-toggle--active')
        const modal = _buildManageModal(appid, gameName, userSubs)
        document.body.appendChild(modal)
        modal.querySelector('.community-manage-input').focus()

        // Clear active state when modal is removed
        const observer = new MutationObserver(() => {
            if (!document.body.contains(modal)) {
                toggleBtn.classList.remove('community-manage-toggle--active')
                observer.disconnect()
            }
        })
        observer.observe(document.body, { childList: true })
    })
}

function _triggerResync(appid, gameName) {
    fetch(`/relay/api/reddit/${appid}/sync?name=${encodeURIComponent(gameName)}`, { method: 'POST' })
        .catch(() => {})
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
        el.classList.toggle('is-user-filtered',     prefs.filtered.has(a))
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
        const isFiltered    = first?.classList.contains('is-user-filtered') ?? false
        const isMuted       = first?.classList.contains('is-user-muted')       ?? false
        const isFavorited   = first?.classList.contains('is-user-favorited')   ?? false
        const isHighlighted = first?.classList.contains('is-user-highlighted') ?? false

        showContextMenu(e, [
            {
                label: isFiltered ? `Remove filter on u/${username}` : `Filter u/${username}`,
                action: () => {
                    const nowOn = !isFiltered
                    targets.forEach(el => el.classList.toggle('is-user-filtered', nowOn))
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
