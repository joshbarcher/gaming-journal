<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { SteamGame, CommunitySource, LoadedPrefs, RedditSource, RedditData } from '../../types.js'
    import { loadPrefs, toggleFilter, toggleMute, toggleFavorite, toggleHighlight } from '../../js/community-user-prefs.js'
    import { showContextMenu } from '../../js/views/context-menu.js'
    import { fmtScore, fmtTime, thumbSrc } from '../../js/views/community-render.js'
    import SubredditLoader from './SubredditLoader.svelte'
    import Breadcrumb from '../Breadcrumb.svelte'

    let { appid } = $props()

    const PAGE_SIZE = 25

    // ── State ──────────────────────────────────────────────────────────────────

    let game        = $state<SteamGame | null>(null)
    let sources     = $state<CommunitySource[]>([])
    let prefs       = $state<LoadedPrefs>({ filtered: new Set<string>(), muted: new Set<string>(), favorited: new Set<string>(), highlighted: new Set<string>() })
    let loading     = $state(true)
    let error       = $state<string | null>(null)
    let activeTab   = $state('__all__')
    let shownCounts = $state<Record<string, number>>({})

    type PendingSub = { name: string; status: string; error: boolean }
    let pendingSub  = $state<PendingSub | null>(null)
    let showModal   = $state(false)

    let modalInput      = $state('')
    let modalStatus     = $state('')
    let modalStatusType = $state('')
    let modalValidName  = $state<string | null>(null)
    let _debounce: ReturnType<typeof setTimeout> | null = null

    // ── Derived ────────────────────────────────────────────────────────────────

    let allSource = $derived.by(() => {
        const seen  = new Set()
        const posts = []
        for (const s of sources) {
            for (const p of s.posts) {
                if (!seen.has(p.id)) { seen.add(p.id); posts.push(p) }
            }
        }
        posts.sort((a, b) => (b.createdUtc ?? 0) - (a.createdUtc ?? 0))
        return { id: '__all__', label: 'All', posts }
    })

    let displaySources = $derived([allSource, ...sources])

    let sourcePanels = $derived.by(() =>
        displaySources.map(src => ({
            ...src,
            visible: src.posts.slice(0, shownCounts[src.id] ?? PAGE_SIZE),
            hasMore: src.posts.length > (shownCounts[src.id] ?? PAGE_SIZE),
        }))
    )

    let totalPosts = $derived(sources.reduce((n, s) => n + s.posts.length, 0))

    // ── Infinite scroll action ─────────────────────────────────────────────────

    function sentinel(node: Element, onVisible: () => void) {
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) onVisible() }, { rootMargin: '300px' })
        obs.observe(node)
        return { destroy: () => obs.disconnect() }
    }

    function loadMore(sourceId: string) {
        shownCounts[sourceId] = (shownCounts[sourceId] ?? PAGE_SIZE) + PAGE_SIZE
    }

    // ── Prefs ──────────────────────────────────────────────────────────────────

    function _setPref(key: keyof LoadedPrefs, username: string, value: boolean) {
        const s = new Set(prefs[key])
        value ? s.add(username) : s.delete(username)
        prefs = { ...prefs, [key]: s }
    }

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
                action: () => {
                    _setPref('filtered', username, !isFiltered)
                    toggleFilter(username).catch(console.warn)
                },
            },
            {
                label: isMuted ? `Unmute u/${username}` : `Mute u/${username}`,
                action: () => {
                    _setPref('muted', username, !isMuted)
                    toggleMute(username).catch(console.warn)
                },
            },
            'separator',
            {
                label: isHighlighted ? `Remove highlight (this game)` : `Highlight u/${username} (this game)`,
                action: () => {
                    _setPref('highlighted', username, !isHighlighted)
                    toggleHighlight(appid, username).catch(console.warn)
                },
            },
            {
                label: isFavorited ? `Remove favorite on u/${username}` : `Favorite u/${username}`,
                action: () => {
                    _setPref('favorited', username, !isFavorited)
                    toggleFavorite(username).catch(console.warn)
                },
            },
        ])
    }

    // ── Manage modal ───────────────────────────────────────────────────────────

    function openModal() {
        modalInput = ''
        modalStatus = ''
        modalStatusType = ''
        modalValidName = null
        showModal = true
    }

    function handleModalInput() {
        clearTimeout(_debounce ?? undefined)
        modalValidName = null
        const val = modalInput.trim().replace(/^r\//i, '')
        if (!val) { modalStatus = ''; modalStatusType = ''; return }
        modalStatus = '…'
        modalStatusType = 'loading'
        _debounce = setTimeout(async () => {
            try {
                const res  = await fetch(`/relay/api/reddit/validate-subreddit?name=${encodeURIComponent(val)}`)
                const data = await res.json()
                if (data.valid) {
                    modalValidName  = data.name
                    modalStatus     = `✓ ${data.name} · ${(data.subscribers ?? 0).toLocaleString()} members`
                    modalStatusType = 'valid'
                } else {
                    modalStatus     = '✗ Not found'
                    modalStatusType = 'invalid'
                }
            } catch {
                modalStatus     = '✗ Check failed'
                modalStatusType = 'invalid'
            }
        }, 600)
    }

    function doAddSub() {
        if (!modalValidName) return
        const name = modalValidName
        showModal = false
        addSubreddit(name)
    }

    // Escape key for modal
    $effect(() => {
        if (!showModal) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') showModal = false }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    })

    // ── Add subreddit flow (SSE) ───────────────────────────────────────────────

    async function addSubreddit(name: string) {
        await fetch(`/api/reddit-subreddits/${appid}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name }),
        }).catch(() => {})

        pendingSub = { name, status: 'Starting sync…', error: false }
        activeTab  = '__pending__'

        try {
            const syncUrl = `/relay/api/reddit/${appid}/sync?name=${encodeURIComponent(game?.name ?? '')}`
            for (let attempt = 0; attempt < 15; attempt++) {
                const r = await fetch(syncUrl, { method: 'POST' }).catch(() => null)
                if (!r || r.status !== 409) break
                pendingSub = { ...pendingSub!, status: 'Waiting for another sync to finish…' }
                await new Promise(r => setTimeout(r, 4_000))
            }

            await new Promise<void>((resolve) => {
                const es       = new EventSource(`/relay/api/reddit/${appid}/sync/progress`)
                const fallback = setTimeout(() => { es.close(); resolve() }, 90_000)
                es.onmessage = (e) => {
                    try {
                        const ev = JSON.parse(e.data)
                        if (ev.type === 'status') pendingSub = { ...pendingSub!, status: ev.message }
                        if (ev.type === 'done')   { clearTimeout(fallback); es.close(); resolve() }
                    } catch {}
                }
                es.onerror = () => { clearTimeout(fallback); es.close(); resolve() }
            })

            const res    = await fetch(`/relay/api/reddit/${appid}`)
            const data   = (res.ok ? await res.json() : null) as RedditData | null
            const source = data?.sources?.find((s: RedditSource) => s.subreddit.toLowerCase() === name.toLowerCase()) ?? null
            const posts  = (source?.posts ?? []).map(p => ({ ...p, subreddit: p.subreddit ?? source?.subreddit ?? name }))

            const newSource = { id: source?.subreddit ?? name, label: `r/${source?.subreddit ?? name}`, posts }
            sources    = [...sources, newSource]
            activeTab  = newSource.id
            pendingSub = null
        } catch (err) {
            console.error('[community] add-sub failed:', err)
            pendingSub = { ...pendingSub!, error: true, status: 'Failed to fetch posts.' }
        }
    }

    // ── Load ───────────────────────────────────────────────────────────────────

    onMount(async () => {
        try {
            const [gameRes, redditRes, userSubsRes] = await Promise.all([
                fetch(`/relay/api/games/${appid}`),
                fetch(`/relay/api/reddit/${appid}`),
                fetch(`/api/reddit-subreddits/${appid}`),
            ])
            if (!gameRes.ok) throw new Error(`Game HTTP ${gameRes.status}`)
            game = await gameRes.json()
            const userSubs = userSubsRes.ok ? await userSubsRes.json() : []

            let redditData
            if (redditRes.ok) {
                redditData = await redditRes.json()
            } else {
                const r2 = await fetch(`/relay/api/reddit/${appid}?name=${encodeURIComponent(game?.name ?? '')}`)
                redditData = r2.ok ? await r2.json() : null
            }

            sources = ((redditData as RedditData | null)?.sources ?? [])
                .filter((s: RedditSource) => s.posts.length > 0)
                .map((s: RedditSource) => ({
                    id:    s.subreddit,
                    label: `r/${s.subreddit}`,
                    posts: s.posts.map(p => ({ ...p, subreddit: p.subreddit ?? s.subreddit })),
                }))

            prefs = await loadPrefs(appid)
        } catch (err) {
            error = (err as Error).message
        } finally {
            loading = false
        }
    })
</script>

{#if loading}
    <div class="community-loader-wrap"><div class="community-loader"></div></div>
{:else if error}
    <p class="page-error">Failed to load: {error}</p>
{:else if game}
<div class="community-page" oncontextmenu={handleContextMenu}>
    <div class="community-header">
        <div class="community-header-body">
            <Breadcrumb crumbs={[
                { label: 'Home', href: '/' },
                { label: game.name ?? 'Game', href: `/game/${appid}` },
                { label: 'Community' },
            ]} />
            <h1 class="community-title">{game.name ?? ''}</h1>
            <p class="community-subtitle">{totalPosts} post{totalPosts !== 1 ? 's' : ''} from Reddit</p>
        </div>
    </div>

    <div class="community-body">
        {#if sources.length === 0 && pendingSub == null}
            <p class="community-empty">No community posts found for this game.</p>
            <div class="community-empty-manage">
                <button class="community-manage-toggle" onclick={openModal}>⚙ Manage Subreddits</button>
            </div>
        {:else}
            <!-- Tab bar -->
            <div class="community-tabs-bar">
                <div class="community-tabs">
                    {#each displaySources as src (src.id)}
                        <button
                            class="community-tab"
                            class:community-tab--active={activeTab === src.id}
                            onclick={() => activeTab = src.id}
                        >
                            {src.label}
                            <span class="community-tab-count">{src.posts.length}</span>
                        </button>
                    {/each}
                    {#if pendingSub}
                        <button class="community-tab community-tab--loading" disabled>
                            r/{pendingSub.name}
                            <span class="community-tab-spinner"></span>
                        </button>
                    {/if}
                </div>
                <button class="community-manage-toggle" title="Manage subreddits" onclick={openModal}>⚙ Subreddits</button>
            </div>

            <!-- Panels -->
            <div class="community-panels">
                {#each sourcePanels as panel (panel.id)}
                    <div class="community-panel" class:community-panel--active={activeTab === panel.id}>
                        {#each panel.visible as post (post.id)}
                            {@const thumb = thumbSrc(post)}
                            {@const href = `/community/${appid}/thread/${post.id}?sub=${encodeURIComponent(post.subreddit ?? '')}`}
                            <a
                                class="community-post-card"
                                class:community-post-card--has-image={!!thumb}
                                class:is-user-filtered={prefs.filtered.has(post.author ?? '')}
                                class:is-user-muted={prefs.muted.has(post.author ?? '')}
                                class:is-user-favorited={prefs.favorited.has(post.author ?? '')}
                                class:is-user-highlighted={prefs.highlighted.has(post.author ?? '')}
                                href={href}
                                data-author={post.author ?? ''}
                            >
                                {#if thumb}
                                    <div class="community-post-img-wrap">
                                        {#if post.isVideo}<span class="community-post-play">▶</span>{/if}
                                        {#if post.isGallery && (post.galleryImages?.length ?? 0) > 1}
                                            <span class="community-post-gallery-badge">⊞ {post.galleryImages?.length}</span>
                                        {/if}
                                        <img
                                            class="community-post-img"
                                            src={thumb}
                                            alt=""
                                            loading="lazy"
                                            onerror={(e) => e.currentTarget.closest('.community-post-img-wrap')?.remove()}
                                        >
                                    </div>
                                {/if}
                                <div class="community-post-content">
                                    <div class="community-post-header">
                                        <span class="community-post-title">{post.title}</span>
                                    </div>
                                    {#if post.selftext}
                                        <p class="community-post-body">{post.selftext}</p>
                                    {/if}
                                    <div class="community-post-meta">
                                        <span class="community-post-score">▲ {fmtScore(post.score)}</span>
                                        <span class="community-post-comments">💬 {(post.numComments ?? 0).toLocaleString()}</span>
                                        <span class="community-post-author">u/{post.author ?? ''}</span>
                                        <span class="community-post-sub">r/{post.subreddit ?? ''}</span>
                                        <span class="community-post-time">{fmtTime(post.createdUtc)}</span>
                                        {#if post.flair}<span class="community-post-flair">{post.flair}</span>{/if}
                                    </div>
                                </div>
                            </a>
                        {/each}

                        {#if panel.hasMore}
                            <div use:sentinel={() => loadMore(panel.id)}></div>
                        {/if}
                    </div>
                {/each}

                {#if pendingSub}
                    <div class="community-panel community-panel--active">
                        {#if pendingSub.error}
                            <p class="community-empty">Failed to fetch posts.</p>
                        {:else}
                            <SubredditLoader status={pendingSub.status} />
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<!-- Manage subreddits modal -->
{#if showModal}
    <div class="community-manage-modal" onclick={(e) => { if (e.target === e.currentTarget) showModal = false }}>
        <div class="community-manage-dialog">
            <div class="community-manage-dialog-header">
                <p class="community-manage-label">Add Subreddit</p>
                <button class="community-manage-close" onclick={() => showModal = false}>×</button>
            </div>
            <div class="community-manage-add-row">
                <span class="community-manage-prefix">r/</span>
                <input
                    class="community-manage-input"
                    type="text"
                    placeholder="subreddit name"
                    autocomplete="off"
                    spellcheck="false"
                    autofocus
                    bind:value={modalInput}
                    oninput={handleModalInput}
                    onpaste={() => setTimeout(handleModalInput, 0)}
                    onkeydown={(e) => { if (e.key === 'Enter' && modalValidName) doAddSub() }}
                >
                <button class="community-manage-add-btn" disabled={!modalValidName} onclick={doAddSub}>Add</button>
            </div>
            {#if modalStatus}
                <p class="community-manage-status community-manage-status--{modalStatusType}">{modalStatus}</p>
            {/if}
        </div>
    </div>
{/if}
{/if}
