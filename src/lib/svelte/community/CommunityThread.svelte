<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { SteamGame, RedditPost, RedditComment, LoadedPrefs } from '../../types.js'
    import { loadPrefs, toggleFilter, toggleMute, toggleFavorite, toggleHighlight } from '../../js/community-user-prefs.js'
    import { showContextMenu } from '../../js/views/context-menu.js'
    import { fmtScore, fmtTime, imgSrc, videoSrc, flattenComments, countComments, renderComment } from '../../js/views/community-render.js'

    let { appid, postId, sub = '' } = $props()

    // ── State ──────────────────────────────────────────────────────────────────

    let game         = $state<SteamGame | null>(null)
    let post         = $state<RedditPost | null>(null)
    let subreddit    = $state('')
    let comments     = $state<RedditComment[]>([])
    let prefs        = $state<LoadedPrefs>({ filtered: new Set<string>(), muted: new Set<string>(), favorited: new Set<string>(), highlighted: new Set<string>() })
    let commentCount = $state(0)
    let loading      = $state(true)
    let error        = $state<string | null>(null)
    let refreshing   = $state(false)
    let refreshLabel = $state('↻ Refresh')

    let containerEl = $state<HTMLElement | null>(null)

    // ── Prefs ──────────────────────────────────────────────────────────────────

    function _setPref(key: keyof LoadedPrefs, username: string, value: boolean) {
        const s = new Set(prefs[key])
        value ? s.add(username) : s.delete(username)
        prefs = { ...prefs, [key]: s }
    }

    function applyPrefs(root: Element | null | undefined) {
        root?.querySelectorAll('[data-author]').forEach(el => {
            const a = (el as HTMLElement).dataset.author
            if (!a) return
            el.classList.toggle('is-user-filtered',    prefs.filtered.has(a))
            el.classList.toggle('is-user-muted',       prefs.muted.has(a))
            el.classList.toggle('is-user-favorited',   prefs.favorited.has(a))
            el.classList.toggle('is-user-highlighted', prefs.highlighted.has(a))
        })
    }

    // Reapply pref classes whenever prefs change or new comments are rendered
    $effect(() => {
        prefs.filtered; prefs.muted; prefs.favorited; prefs.highlighted
        comments.length
        if (containerEl) applyPrefs(containerEl)
    })

    // ── Context menu ───────────────────────────────────────────────────────────

    function handleContextMenu(e: MouseEvent) {
        const target = (e.target as Element)?.closest('[data-author]')
        if (!target) return
        const username = (target as HTMLElement).dataset.author
        if (!username || username === '[deleted]') return
        e.preventDefault()

        const isFiltered    = prefs.filtered.has(username)
        const isMuted       = prefs.muted.has(username)
        const isFavorited   = prefs.favorited.has(username)
        const isHighlighted = prefs.highlighted.has(username)

        showContextMenu(e, [
            {
                label: isFiltered ? `Remove filter on u/${username}` : `Filter u/${username}`,
                action: () => { _setPref('filtered', username, !isFiltered); toggleFilter(username).catch(console.warn) },
            },
            {
                label: isMuted ? `Unmute u/${username}` : `Mute u/${username}`,
                action: () => { _setPref('muted', username, !isMuted); toggleMute(username).catch(console.warn) },
            },
            'separator',
            {
                label: isHighlighted ? `Remove highlight (this game)` : `Highlight u/${username} (this game)`,
                action: () => { _setPref('highlighted', username, !isHighlighted); toggleHighlight(appid, username).catch(console.warn) },
            },
            {
                label: isFavorited ? `Remove favorite on u/${username}` : `Favorite u/${username}`,
                action: () => { _setPref('favorited', username, !isFavorited); toggleFavorite(username).catch(console.warn) },
            },
        ])
    }

    // ── Comment toggle wiring (runs after each render) ─────────────────────────

    $effect(() => {
        // Track comments to re-run after new ones are added
        comments.length
        if (!containerEl) return

        containerEl.querySelectorAll('.thread-comment-toggle:not([data-wired])').forEach(btn => {
            ;(btn as HTMLElement).dataset.wired = '1'
            btn.addEventListener('click', () => {
                const comment = btn.closest('.thread-comment')
                const replies = comment?.querySelector('.thread-comment-replies')
                if (!replies) return
                const nowHidden = replies.toggleAttribute('hidden')
                btn.textContent = nowHidden ? '+' : '−'
                btn.setAttribute('aria-label', nowHidden ? 'Expand replies' : 'Collapse replies')
            })
        })
    })

    // ── Image lightbox ─────────────────────────────────────────────────────────

    let _lightboxCleanup: (() => void) | null = null

    function initLightbox(container: HTMLElement) {
        if (_lightboxCleanup) return
        const handler = (e: Event) => {
            const wrap = (e.target as Element)?.closest('[data-lightbox-src]') as HTMLElement | null
            if (!wrap) return

            const grid = wrap.closest('.community-gallery-grid')
            const srcs = grid
                ? [...grid.querySelectorAll('[data-lightbox-src]')].map(el => (el as HTMLElement).dataset.lightboxSrc!)
                : [wrap.dataset.lightboxSrc!]
            let idx = grid ? srcs.indexOf(wrap.dataset.lightboxSrc!) : 0

            const modal   = document.createElement('div')
            modal.className = 'community-img-lightbox'

            const img = document.createElement('img')
            img.alt = ''

            const prevBtn = document.createElement('button')
            prevBtn.className = 'lightbox-chevron lightbox-chevron--prev'
            prevBtn.innerHTML = '&#8249;'

            const nextBtn = document.createElement('button')
            nextBtn.className = 'lightbox-chevron lightbox-chevron--next'
            nextBtn.innerHTML = '&#8250;'

            const setImage = (i: number) => {
                idx = (i + srcs.length) % srcs.length
                img.src = srcs[idx]
                prevBtn.style.visibility = srcs.length > 1 ? 'visible' : 'hidden'
                nextBtn.style.visibility = srcs.length > 1 ? 'visible' : 'hidden'
            }

            prevBtn.addEventListener('click', (e) => { e.stopPropagation(); setImage(idx - 1) })
            nextBtn.addEventListener('click', (e) => { e.stopPropagation(); setImage(idx + 1) })

            modal.appendChild(prevBtn)
            modal.appendChild(img)
            modal.appendChild(nextBtn)
            setImage(idx)

            const close = () => { modal.remove(); document.removeEventListener('keydown', onKey) }
            modal.addEventListener('click', (e) => { if (!(e.target as Element)?.closest('.lightbox-chevron')) close() })

            const onKey = (e: KeyboardEvent) => {
                if (e.key === 'Escape')     close()
                if (e.key === 'ArrowLeft')  setImage(idx - 1)
                if (e.key === 'ArrowRight') setImage(idx + 1)
            }
            document.addEventListener('keydown', onKey)
            document.body.appendChild(modal)
        }
        container.addEventListener('click', handler)
        _lightboxCleanup = () => container.removeEventListener('click', handler)
    }

    function initCarousel(container: HTMLElement) {
        container.addEventListener('click', (e) => {
            const album = (e.target as Element)?.closest('[data-carousel]') as HTMLElement | null
            if (!album) return
            const srcs    = JSON.parse(album.dataset.carousel!)
            let   current = 0

            const modal  = document.createElement('div')
            modal.className = 'community-carousel-modal'

            const render = () => {
                modal.innerHTML = `
                    <div class="community-carousel-dialog">
                        <button class="community-carousel-close" aria-label="Close">×</button>
                        <div class="community-carousel-img-wrap">
                            <img src="${srcs[current]}" alt="">
                        </div>
                        <div class="community-carousel-controls">
                            <button class="community-carousel-prev" ${current === 0 ? 'disabled' : ''} aria-label="Previous">←</button>
                            <span class="community-carousel-counter">${current + 1} / ${srcs.length}</span>
                            <button class="community-carousel-next" ${current === srcs.length - 1 ? 'disabled' : ''} aria-label="Next">→</button>
                        </div>
                    </div>`
                modal.querySelector('.community-carousel-close')!.addEventListener('click', close)
                modal.querySelector('.community-carousel-prev')!.addEventListener('click', () => { if (current > 0) { current--; render() } })
                modal.querySelector('.community-carousel-next')!.addEventListener('click', () => { if (current < srcs.length - 1) { current++; render() } })
            }

            const close = () => { modal.remove(); document.removeEventListener('keydown', onKey) }
            modal.addEventListener('click', (e) => { if (e.target === modal) close() })
            const onKey = (e: KeyboardEvent) => {
                if (e.key === 'Escape')      close()
                if (e.key === 'ArrowLeft'  && current > 0)              { current--; render() }
                if (e.key === 'ArrowRight' && current < srcs.length - 1) { current++; render() }
            }
            document.addEventListener('keydown', onKey)
            render()
            document.body.appendChild(modal)
        })
    }

    // ── Thread refresh ─────────────────────────────────────────────────────────

    async function refresh() {
        refreshing = true
        refreshLabel = '↻ Fetching…'
        try {
            const res = await fetch(`/relay/api/reddit/${appid}/thread/${postId}?sub=${encodeURIComponent(sub)}&force=true`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const thread = await res.json()

            const existingIds = new Set(comments.map(c => c.id))
            const newComments = ((thread.comments ?? []) as RedditComment[]).filter(c => !existingIds.has(c.id))
            if (newComments.length > 0) comments = [...comments, ...newComments]

            // Update scores for existing comments via DOM (avoids disturbing expand/collapse state)
            const allNew   = flattenComments(thread.comments ?? [])
            const scoreMap = new Map(allNew.map(c => [c.id, c.score]))
            containerEl?.querySelectorAll('.thread-comment[data-id]').forEach(el => {
                const s = scoreMap.get((el as HTMLElement).dataset.id)
                if (s == null) return
                const scoreEl = el.querySelector('.thread-comment-score')
                if (scoreEl) scoreEl.textContent = `▲ ${fmtScore(s)}`
            })

            commentCount = countComments(thread.comments ?? [])
            refreshLabel = newComments.length > 0 ? `↻ +${newComments.length} new` : '↻ Up to date'
        } catch (err) {
            refreshLabel = '↻ Failed'
            console.warn('[thread-refresh]', err)
        } finally {
            refreshing = false
            setTimeout(() => { refreshLabel = '↻ Refresh' }, 3000)
        }
    }

    // ── Derived display values for the post card ───────────────────────────────

    let postVid  = $derived(post ? videoSrc(post) : null)
    let postImg  = $derived(!postVid && post && !post.isGallery ? imgSrc(post) : null)
    let gallery  = $derived(post?.isGallery ? (post.galleryImages ?? []) : [])

    // ── Load ───────────────────────────────────────────────────────────────────

    onMount(async () => {
        const resolvedSub = sub || new URLSearchParams(window.location.search).get('sub') || ''

        try {
            const abort   = new AbortController()
            const timeout = setTimeout(() => abort.abort(), 20_000)
            let gameRes, threadRes
            try {
                ;[gameRes, threadRes] = await Promise.all([
                    fetch(`/relay/api/games/${appid}`, { signal: abort.signal }),
                    fetch(`/relay/api/reddit/${appid}/thread/${postId}?sub=${encodeURIComponent(resolvedSub)}`, { signal: abort.signal }),
                ])
            } finally {
                clearTimeout(timeout)
            }
            if (!gameRes.ok)   throw new Error(`Game HTTP ${gameRes.status}`)
            if (!threadRes.ok) throw new Error(`Thread HTTP ${threadRes.status}`)

            game         = await gameRes.json()
            const thread = await threadRes.json()
            post         = thread.post
            subreddit    = thread.subreddit ?? resolvedSub
            comments     = thread.comments ?? []
            commentCount = countComments(comments)
            prefs        = await loadPrefs(appid)
        } catch (err) {
            error = (err as Error).name === 'AbortError'
                ? 'Thread took too long to load — the relay may be stuck.'
                : (err as Error).message
        } finally {
            loading = false
        }

    })

    // containerEl is only set after post loads (inside {:else if post}), so wire
    // lightbox and carousel via $effect rather than onMount.
    $effect(() => {
        if (!containerEl) return
        initLightbox(containerEl)
        initCarousel(containerEl)
    })

    onDestroy(() => {
        if (_lightboxCleanup) _lightboxCleanup()
    })
</script>

{#if loading}
    <div class="community-loader-wrap"><div class="community-loader"></div></div>
{:else if error}
    <p class="page-error">Failed to load: {error}</p>
{:else if post}
<div class="community-page" bind:this={containerEl} oncontextmenu={handleContextMenu}>
    <div class="community-thread-nav">
        <a class="community-back" href="/community/{appid}">← Community</a>
    </div>

    <!-- Full post card -->
    <div class="community-thread-post">
        <div class="community-thread-post-card" data-author={post.author ?? ''}>
            <div class="community-post-header">
                {#if post.flair}<span class="community-post-flair">{post.flair}</span>{/if}
                <span class="community-post-title community-post-title--large">{post.title}</span>
            </div>

            {#if postVid}
                <div class="community-thread-post-image">
                    <video class="community-thread-post-video" src={postVid} controls loop muted playsinline preload="metadata"></video>
                </div>
            {:else if gallery.length > 0}
                <div class="community-gallery-grid">
                    {#each gallery as g}
                        {@const src  = g.localImage ? `/relay${g.localImage}` : (g.thumbnail ?? g.url)}
                        {@const full = g.localImage ? `/relay${g.localImage}` : g.url}
                        <div class="community-gallery-item" data-lightbox-src={full}>
                            <img src={src} alt="" loading="lazy" onerror={(e) => e.currentTarget.closest('.community-gallery-item')?.remove()}>
                        </div>
                    {/each}
                </div>
            {:else if postImg}
                <div class="community-thread-post-image" data-lightbox-src={postImg}>
                    <img src={postImg} alt="" loading="lazy" onerror={(e) => e.currentTarget.closest('.community-thread-post-image')?.remove()}>
                </div>
            {/if}

            {#if post.selftext}
                <div class="community-thread-post-body">{post.selftext}</div>
            {/if}

            <div class="community-post-meta">
                <span class="community-post-score">▲ {fmtScore(post.score)}</span>
                <span class="community-post-comments">💬 {(post.numComments ?? 0).toLocaleString()}</span>
                <span class="community-post-author">u/{post.author ?? ''}</span>
                <span class="community-post-sub">r/{subreddit ?? post.subreddit ?? ''}</span>
                <span class="community-post-time">{fmtTime(post.createdUtc)}</span>
                <a class="community-post-reddit-link" href={post.permalink} target="_blank" rel="noopener noreferrer">View on Reddit ↗</a>
            </div>
        </div>
    </div>

    <!-- Comments -->
    <div class="community-thread-comments">
        <div class="community-comments-header">
            <h2 class="community-comments-heading">{commentCount} Comment{commentCount !== 1 ? 's' : ''}</h2>
            <button class="community-refresh-btn" disabled={refreshing} onclick={refresh}>{refreshLabel}</button>
        </div>
        {#if comments.length === 0}
            <p class="community-empty">No comments yet.</p>
        {:else}
            {#each comments as c (c.id)}
                {@html renderComment(c, post.permalink ?? '')}
            {/each}
        {/if}
    </div>
</div>
{/if}
