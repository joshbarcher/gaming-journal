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

const PAGE_SIZE = 25

export async function renderCommunity(appid, container) {
    container.innerHTML = '<div class="community-loader-wrap"><div class="community-loader"></div></div>'

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
    const display    = [_allSource(sources), ...sources]

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
                    : _sourceTabs(display, appid, game.name ?? '', userSubs)}
            </div>
        </div>`

    _applyAllPrefs(container, prefs)
    _initTabs(container)
    _initNavLinks(container)
    _initUserContextMenus(container, appid)
    _initManagePanel(container, appid, game.name ?? '', userSubs)
    _initInfiniteScroll(container, display, appid, prefs)
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

function _renderPanelPosts(posts, appid) {
    if (posts.length === 0) return '<p class="community-empty">No posts found.</p>'
    const initial = posts.slice(0, PAGE_SIZE)
    return initial.map(p => _postCard(p, appid)).join('')
        + (posts.length > PAGE_SIZE ? '<div class="community-scroll-sentinel"></div>' : '')
}

function _sourceTabs(display, appid, gameName, userSubs) {
    const tabs = display.map((s, i) => `
        <button class="community-tab${i === 0 ? ' community-tab--active' : ''}" data-source="${escapeHtml(s.id)}">
            ${escapeHtml(s.label)}
            <span class="community-tab-count">${s.posts.length}</span>
        </button>`).join('')

    const panels = display.map((s, i) => `
        <div class="community-panel${i === 0 ? ' community-panel--active' : ''}" data-source="${escapeHtml(s.id)}">
            ${_renderPanelPosts(s.posts, appid)}
        </div>`).join('')

    return `
        <div class="community-tabs-bar">
            <div class="community-tabs">${tabs}</div>
            <button class="community-manage-toggle" title="Manage subreddits">⚙ Subreddits</button>
        </div>
        <div class="community-panels">${panels}</div>`
}

function _observePanel(panel, postMap, appid, prefs) {
    const sentinel = panel.querySelector('.community-scroll-sentinel')
    if (!sentinel) return
    const srcId    = panel.dataset.source
    const observer = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting) return
        const remaining = postMap.get(srcId)
        if (!remaining?.length) { observer.disconnect(); sentinel.remove(); return }
        const batch = remaining.splice(0, PAGE_SIZE)
        sentinel.insertAdjacentHTML('beforebegin', batch.map(p => _postCard(p, appid)).join(''))
        if (prefs) _applyAllPrefs(panel, prefs)
        if (!remaining.length) { observer.disconnect(); sentinel.remove() }
    }, { rootMargin: '300px' })
    observer.observe(sentinel)
}

function _initInfiniteScroll(container, display, appid, prefs) {
    const postMap = new Map(display.map(s => [s.id, s.posts.slice(PAGE_SIZE)]))
    container.querySelectorAll('.community-panel').forEach(panel => {
        _observePanel(panel, postMap, appid, prefs)
    })
}

function _thumbSrc(post) {
    if (post.localThumb) return `/relay${post.localThumb}`
    if (post.localImage) return `/relay${post.localImage}`
    if (post.thumbnail)  return post.thumbnail
    const firstGallery = post.galleryImages?.[0]
    if (firstGallery?.localImage) return `/relay${firstGallery.localImage}`
    if (firstGallery?.thumbnail)  return firstGallery.thumbnail
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
    const thumbSrc     = _thumbSrc(post)
    const galleryCount = post.isGallery ? (post.galleryImages?.length ?? 0) : 0
    const playIcon     = post.isVideo ? '<span class="community-post-play">▶</span>' : ''
    const galleryBadge = galleryCount > 1 ? `<span class="community-post-gallery-badge">⊞ ${galleryCount}</span>` : ''
    const img          = thumbSrc
        ? `<div class="community-post-img-wrap">${playIcon}${galleryBadge}<img class="community-post-img" src="${thumbSrc}" alt="" loading="lazy" onerror="this.closest('.community-post-img-wrap').remove()"></div>`
        : ''
    const href = `/community/${appid}/thread/${post.id}?sub=${encodeURIComponent(post.subreddit ?? '')}`

    return `
        <a class="community-post-card${thumbSrc ? ' community-post-card--has-image' : ''}" href="${href}" data-nav data-author="${escapeHtml(author)}">
            ${img}
            <div class="community-post-content">
                <div class="community-post-header">
                    <span class="community-post-title">${escapeHtml(post.title)}</span>
                </div>
                ${body}
                <div class="community-post-meta">
                    <span class="community-post-score">▲ ${escapeHtml(score)}</span>
                    <span class="community-post-comments">💬 ${(post.numComments ?? 0).toLocaleString()}</span>
                    <span class="community-post-author">u/${escapeHtml(author)}</span>
                    <span class="community-post-sub">r/${escapeHtml(post.subreddit ?? '')}</span>
                    <span class="community-post-time">${escapeHtml(time)}</span>
                    ${flair}
                </div>
            </div>
        </a>`
}

function _buildManageModal(container, appid, gameName) {
    const modal = document.createElement('div')
    modal.className = 'community-manage-modal'

    modal.innerHTML = `
        <div class="community-manage-dialog">
            <div class="community-manage-dialog-header">
                <p class="community-manage-label">Add Subreddit</p>
                <button class="community-manage-close" aria-label="Close">×</button>
            </div>
            <div class="community-manage-add-row">
                <span class="community-manage-prefix">r/</span>
                <input class="community-manage-input" type="text" placeholder="subreddit name" autocomplete="off" spellcheck="false">
                <button class="community-manage-add-btn" disabled>Add</button>
            </div>
            <p class="community-manage-status"></p>
        </div>`

    const close = () => modal.remove()
    modal.addEventListener('click', e => { if (e.target === modal) close() })
    modal.querySelector('.community-manage-close').addEventListener('click', close)
    const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) } }
    document.addEventListener('keydown', onKey)

    const input    = modal.querySelector('.community-manage-input')
    const status   = modal.querySelector('.community-manage-status')
    const addBtn   = modal.querySelector('.community-manage-add-btn')
    let _validName = null
    let _debounce  = null

    const handleInput = () => {
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
    }

    input.addEventListener('input', handleInput)
    input.addEventListener('paste', () => setTimeout(handleInput, 0))

    addBtn.addEventListener('click', () => {
        if (!_validName) return
        const name = _validName
        close()
        _addOptimisticTab(container, appid, gameName, name)
    })

    return modal
}

function _renderSubredditLoader(msg) {
    return `
        <div class="community-sync-wrap">
            <div class="community-loader"></div>
            <p class="community-sync-status">${escapeHtml(msg)}</p>
            <div class="community-sync-bar"><div class="community-sync-bar-fill"></div></div>
        </div>`
}

async function _addOptimisticTab(container, appid, gameName, subreddit) {
    const tabsEl   = container.querySelector('.community-tabs')
    const panelsEl = container.querySelector('.community-panels')
    if (!tabsEl || !panelsEl) return

    // Persist to journal
    await fetch(`/api/reddit-subreddits/${appid}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: subreddit }),
    }).catch(() => {})

    // Optimistic tab — disabled with spinner while sync runs
    const tab = document.createElement('button')
    tab.className      = 'community-tab community-tab--loading'
    tab.dataset.source = subreddit
    tab.disabled       = true
    tab.innerHTML      = `r/${escapeHtml(subreddit)}<span class="community-tab-spinner"></span>`
    tabsEl.appendChild(tab)

    // Loading panel — activate immediately so progress is visible without clicking
    const panel = document.createElement('div')
    panel.className      = 'community-panel community-panel--active'
    panel.dataset.source = subreddit
    panel.innerHTML      = _renderSubredditLoader('Starting sync…')
    panelsEl.appendChild(panel)

    // Deactivate whatever tab/panel was active and switch to the new one
    container.querySelectorAll('.community-tab').forEach(b => b.classList.remove('community-tab--active'))
    container.querySelectorAll('.community-panel').forEach(p => p.classList.remove('community-panel--active'))
    tab.classList.add('community-tab--active')
    panel.classList.add('community-panel--active')

    const setStatus = (msg) => {
        const el = panel.querySelector('.community-sync-status')
        if (el) el.textContent = msg
    }

    try {
        // POST sync — retry on 409 (another game's sync holds the lock)
        const syncUrl = `/relay/api/reddit/${appid}/sync?name=${encodeURIComponent(gameName)}`
        for (let attempt = 0; attempt < 15; attempt++) {
            const r = await fetch(syncUrl, { method: 'POST' }).catch(() => null)
            if (!r || r.status !== 409) break
            setStatus('Waiting for another sync to finish…')
            await new Promise(r => setTimeout(r, 4_000))
        }

        // Open SSE after sync is confirmed started — initProgress is called server-side
        // before the 200 response, so the entry exists by the time we connect.
        await new Promise((resolve) => {
            const es = new EventSource(`/relay/api/reddit/${appid}/sync/progress`)
            const fallback = setTimeout(() => { es.close(); resolve() }, 90_000)

            es.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data)
                    if (event.type === 'status') setStatus(event.message)
                    if (event.type === 'done')   { clearTimeout(fallback); es.close(); resolve() }
                } catch {}
            }
            es.onerror = () => { clearTimeout(fallback); es.close(); resolve() }
        })

        let source = null
        const res  = await fetch(`/relay/api/reddit/${appid}`)
        const data = res.ok ? await res.json() : null
        source = data?.sources?.find(s => s.subreddit.toLowerCase() === subreddit.toLowerCase()) ?? null

        const posts = (source?.posts ?? []).map(p => ({ ...p, subreddit: p.subreddit ?? source?.subreddit ?? subreddit }))
        panel.innerHTML = _renderPanelPosts(posts, appid)
        if (posts.length > PAGE_SIZE) {
            const postMap = new Map([[subreddit, posts.slice(PAGE_SIZE)]])
            _observePanel(panel, postMap, appid, null)
        }

        const tabLabel = `r/${escapeHtml(source?.subreddit ?? subreddit)}`
        tab.innerHTML = `${tabLabel}<span class="community-tab-count">${posts.length}</span>`
        tab.disabled  = false
        tab.classList.remove('community-tab--loading')
    } catch (err) {
        console.error('[community] add-sub failed:', err)
        tab.innerHTML = `r/${escapeHtml(subreddit)}<span class="community-tab-error">✗</span>`
        tab.classList.remove('community-tab--loading')
        tab.classList.add('community-tab--error')
        panel.innerHTML = '<p class="community-empty">Failed to fetch posts.</p>'
    }

    _initTabs(container)
}

function _initManagePanel(container, appid, gameName, userSubs) {
    const toggleBtn = container.querySelector('.community-manage-toggle')
    if (!toggleBtn) return

    toggleBtn.addEventListener('click', () => {
        toggleBtn.classList.add('community-manage-toggle--active')
        const modal = _buildManageModal(container, appid, gameName)
        document.body.appendChild(modal)
        modal.querySelector('.community-manage-input').focus()

        const observer = new MutationObserver(() => {
            if (!document.body.contains(modal)) {
                toggleBtn.classList.remove('community-manage-toggle--active')
                observer.disconnect()
            }
        })
        observer.observe(document.body, { childList: true })
    })
}

function _initTabs(container) {
    container.querySelectorAll('.community-tab:not([data-wired])').forEach(btn => {
        btn.dataset.wired = '1'
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
    container.innerHTML = '<div class="community-loader-wrap"><div class="community-loader"></div></div>'

    let game, thread, prefs
    try {
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort(), 20_000)
        let gameRes, threadRes
        try {
            ;[gameRes, threadRes] = await Promise.all([
                fetch(`/relay/api/games/${appid}`, { signal: abort.signal }),
                fetch(`/relay/api/reddit/${appid}/thread/${postId}?sub=${encodeURIComponent(sub)}`, { signal: abort.signal }),
            ])
        } finally {
            clearTimeout(timeout)
        }
        if (!gameRes.ok)   throw new Error(`Game HTTP ${gameRes.status}`)
        if (!threadRes.ok) throw new Error(`Thread HTTP ${threadRes.status}`)
        game   = await gameRes.json()
        thread = await threadRes.json()
        prefs  = await loadPrefs(appid)
    } catch (err) {
        const msg = err.name === 'AbortError' ? 'Thread took too long to load — the relay may be stuck.' : err.message
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(msg)}</p>`
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
    _initImgurCarousel(container)
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
    const videoSrc      = _videoSrc(post)
    const imgSrc        = !videoSrc && !post.isGallery ? _imgSrc(post) : null
    const galleryImages = post.isGallery ? (post.galleryImages ?? []) : []
    const galleryHtml   = galleryImages.length > 0
        ? `<div class="community-gallery-grid">${galleryImages.map(g => {
            const src = g.localImage ? `/relay${g.localImage}` : (g.thumbnail ?? g.url)
            const full = g.localImage ? `/relay${g.localImage}` : g.url
            return `<div class="community-gallery-item" data-lightbox-src="${escapeHtml(full)}"><img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.closest('.community-gallery-item').remove()"></div>`
          }).join('')}</div>`
        : ''
    const img           = videoSrc
        ? `<div class="community-thread-post-image"><video class="community-thread-post-video" src="${videoSrc}" controls loop muted playsinline preload="metadata"></video></div>`
        : galleryHtml
            ? galleryHtml
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

    const rawBody = comment.body ?? null
    // Strip bare Reddit image URLs, Giphy embeds, and Imgur links — rendered separately below
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
        const first  = entry.images[0]
        const src    = first.localImage ? `/relay${first.localImage}` : first.url
        if (entry.images.length === 1) {
            return `<div class="thread-comment-image" data-lightbox-src="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.closest('.thread-comment-image').remove()"></div>`
        }
        const srcs = entry.images.map(img => img.localImage ? `/relay${img.localImage}` : img.url)
        return `<div class="thread-comment-imgur-album" data-carousel="${escapeHtml(JSON.stringify(srcs))}">
            <img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.closest('.thread-comment-imgur-album').remove()">
            <span class="thread-comment-album-badge">+${entry.images.length - 1} more</span>
        </div>`
    }).join('')

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
            <div class="thread-comment-body">${bodyHtml}</div>
            ${imagesHtml}
            ${gifsHtml}
            ${imgurHtml}
            ${repliesHtml}
        </div>`
}

// ── Image lightbox ────────────────────────────────────────────────────────────

function _initImageLightbox(container) {
    if (container._lightboxInit) return
    container._lightboxInit = true
    container.addEventListener('click', e => {
        const wrap = e.target.closest('[data-lightbox-src]')
        if (!wrap) return

        // Collect sibling gallery items if this is inside a gallery grid
        const grid = wrap.closest('.community-gallery-grid')
        const srcs = grid
            ? [...grid.querySelectorAll('[data-lightbox-src]')].map(el => el.dataset.lightboxSrc)
            : [wrap.dataset.lightboxSrc]
        let idx = grid ? srcs.indexOf(wrap.dataset.lightboxSrc) : 0

        const modal = document.createElement('div')
        modal.className = 'community-img-lightbox'

        const img = document.createElement('img')
        img.alt = ''

        const setImage = (i) => {
            idx = (i + srcs.length) % srcs.length
            img.src = srcs[idx]
            if (prevBtn) prevBtn.style.visibility = srcs.length > 1 ? 'visible' : 'hidden'
            if (nextBtn) nextBtn.style.visibility = srcs.length > 1 ? 'visible' : 'hidden'
        }

        const prevBtn = document.createElement('button')
        prevBtn.className = 'lightbox-chevron lightbox-chevron--prev'
        prevBtn.innerHTML = '&#8249;'
        prevBtn.addEventListener('click', e => { e.stopPropagation(); setImage(idx - 1) })

        const nextBtn = document.createElement('button')
        nextBtn.className = 'lightbox-chevron lightbox-chevron--next'
        nextBtn.innerHTML = '&#8250;'
        nextBtn.addEventListener('click', e => { e.stopPropagation(); setImage(idx + 1) })

        modal.appendChild(prevBtn)
        modal.appendChild(img)
        modal.appendChild(nextBtn)
        setImage(idx)

        const close = () => { modal.remove(); document.removeEventListener('keydown', onKey) }
        modal.addEventListener('click', e => { if (e.target === modal) close() })

        const onKey = e => {
            if (e.key === 'Escape')     close()
            if (e.key === 'ArrowLeft')  setImage(idx - 1)
            if (e.key === 'ArrowRight') setImage(idx + 1)
        }
        document.addEventListener('keydown', onKey)

        document.body.appendChild(modal)
    })
}

function _initImgurCarousel(container) {
    if (container._carouselInit) return
    container._carouselInit = true
    container.addEventListener('click', e => {
        const album = e.target.closest('[data-carousel]')
        if (!album) return
        const srcs = JSON.parse(album.dataset.carousel)
        _openCarousel(srcs)
    })
}

function _openCarousel(srcs, startIndex = 0) {
    let current = startIndex

    const modal = document.createElement('div')
    modal.className = 'community-carousel-modal'

    const render = () => {
        const isFirst = current === 0
        const isLast  = current === srcs.length - 1
        modal.innerHTML = `
            <div class="community-carousel-dialog">
                <button class="community-carousel-close" aria-label="Close">×</button>
                <div class="community-carousel-img-wrap">
                    <img src="${escapeHtml(srcs[current])}" alt="">
                </div>
                <div class="community-carousel-controls">
                    <button class="community-carousel-prev" ${isFirst ? 'disabled' : ''} aria-label="Previous">←</button>
                    <span class="community-carousel-counter">${current + 1} / ${srcs.length}</span>
                    <button class="community-carousel-next" ${isLast  ? 'disabled' : ''} aria-label="Next">→</button>
                </div>
            </div>`
        modal.querySelector('.community-carousel-close').addEventListener('click', close)
        modal.querySelector('.community-carousel-prev').addEventListener('click', () => { if (current > 0) { current--; render() } })
        modal.querySelector('.community-carousel-next').addEventListener('click', () => { if (current < srcs.length - 1) { current++; render() } })
    }

    const close = () => { modal.remove(); document.removeEventListener('keydown', onKey) }
    modal.addEventListener('click', e => { if (e.target === modal) close() })

    const onKey = e => {
        if (e.key === 'Escape')      close()
        if (e.key === 'ArrowLeft'  && current > 0)              { current--; render() }
        if (e.key === 'ArrowRight' && current < srcs.length - 1) { current++; render() }
    }
    document.addEventListener('keydown', onKey)

    render()
    document.body.appendChild(modal)
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
