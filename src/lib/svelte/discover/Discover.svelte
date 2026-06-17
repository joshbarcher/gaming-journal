<script lang="ts">
    import { onMount } from 'svelte'
    import { navigate } from '../../js/router.js'
    import type { DiscoverItem, DiscoverSection } from '../../types.js'

    const FEATURED_TABS = [
        { id: 'new_releases', label: 'New Releases', short: 'New'  },
        { id: 'top_sellers',  label: 'Top Sellers',  short: 'Top'  },
        { id: 'coming_soon',  label: 'Coming Soon',  short: 'Soon' },
        { id: 'specials',     label: 'On Sale',       short: 'Sale' },
    ]
    const STORAGE_KEY      = 'disc-state'
    const BLOCKLIST_KEY    = 'disc-title-blocklist'
    const SEARCH_PAGE_SIZE = 40
    const TTL_24H          = 24 * 60 * 60 * 1000

    // ── State ──────────────────────────────────────────────────────────────────

    let mode         = $state('browse')
    let featuredTab  = $state('new_releases')
    let searchQuery  = $state('')
    let featuredData = $state<DiscoverSection[]>([])
    let tabPages     = $state<Record<string, number>>({})
    let owned        = $state<Set<number>>(new Set())
    let wishlist     = $state<Set<number>>(new Set())

    // Search state
    let searchResults  = $state<DiscoverItem[]>([])
    let searchTotal    = $state(0)
    let searchPage     = $state(1)
    let searchLoading  = $state(false)
    let searchError    = $state<string | null>(null)

    // Featured loading
    let featuredLoading = $state(false)
    let featuredError   = $state<string | null>(null)

    let titleBlocklist = $state<string[]>([])

    // Non-reactive
    let _searchCache: Map<number, DiscoverItem[]> = new Map()
    let _debounce: ReturnType<typeof setTimeout> | null = null
    let _lastResults: DiscoverItem[] | null = null

    // ── LocalStorage ──────────────────────────────────────────────────────────

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                savedAt:     Date.now(),
                mode,
                tab:         featuredTab,
                tabPages,
                searchQuery,
                lastResults: _lastResults,
                searchTotal,
                searchPage,
            }))
        } catch { /* storage full / private mode */ }
    }

    function restoreState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY)
            if (!raw) return
            const s = JSON.parse(raw)
            if (s.savedAt && Date.now() - s.savedAt > TTL_24H) { localStorage.removeItem(STORAGE_KEY); return }
            if (s.mode)                      mode        = s.mode
            if (s.tab)                       featuredTab = s.tab
            if (s.tabPages)                  tabPages    = s.tabPages
            if (s.searchQuery != null)       searchQuery = s.searchQuery
            if (s.lastResults !== undefined) _lastResults = s.lastResults
            if (s.searchTotal)               searchTotal  = s.searchTotal
            if (s.searchPage)                searchPage   = s.searchPage
        } catch { /* corrupt storage */ }
    }

    // ── Ownership ─────────────────────────────────────────────────────────────

    async function loadOwnership() {
        try {
            const res = await fetch('/relay/api/games/ownership')
            if (!res.ok) return
            const games = await res.json()
            const o = new Set<number>(), w = new Set<number>()
            for (const g of games) {
                if (g.source === 'library' || g.source === 'both')  o.add(g.appid)
                if (g.source === 'wishlist' || g.source === 'both') w.add(g.appid)
            }
            owned    = o
            wishlist = w
        } catch { /* non-critical */ }
    }

    // ── Featured ──────────────────────────────────────────────────────────────

    async function loadFeatured() {
        featuredLoading = true
        featuredError   = null
        try {
            const res = await fetch('/relay/api/discover/featured')
            if (!res.ok) throw new Error(`${res.status}`)
            featuredData = await res.json()
            for (const s of featuredData) {
                if (!tabPages[s.id]) tabPages[s.id] = 1
            }
            const savedPage = tabPages[featuredTab] ?? 1
            if (savedPage > 1) await loadFeaturedPage(featuredTab, savedPage)
        } catch (err) {
            featuredError = 'Failed to load featured games.'
        } finally {
            featuredLoading = false
        }
    }

    async function loadFeaturedPage(tab: string, page: number) {
        featuredLoading = true
        featuredError   = null
        try {
            const res = await fetch(`/relay/api/discover/featured?tab=${encodeURIComponent(tab)}&page=${page}`)
            if (!res.ok) throw new Error(`${res.status}`)
            const section = await res.json()
            if (featuredData) {
                const idx = featuredData.findIndex(s => s.id === tab)
                if (idx >= 0) {
                    const updated = [...featuredData]
                    updated[idx] = section
                    featuredData = updated
                }
            }
            tabPages = { ...tabPages, [tab]: section.page }
            saveState()
        } catch (err) {
            featuredError = `Failed to load page ${page}.`
        } finally {
            featuredLoading = false
        }
    }

    function switchTab(tab: string) {
        featuredTab = tab
        saveState()
        const existing = featuredData?.find(s => s.id === tab)
        if (!existing) loadFeaturedPage(tab, tabPages[tab] ?? 1)
    }

    let activeSection = $derived(featuredData?.find(s => s.id === featuredTab) ?? null)

    let visibleBrowseItems = $derived(
        (activeSection?.items ?? []).filter(item => {
            if (!titleBlocklist.length) return true
            const lower = item.name.toLowerCase()
            return !titleBlocklist.some(t => lower.includes(t))
        })
    )

    let visibleSearchResults = $derived(
        searchResults.filter(item => {
            if (!titleBlocklist.length) return true
            const lower = item.name.toLowerCase()
            return !titleBlocklist.some(t => lower.includes(t))
        })
    )

    // ── Search ────────────────────────────────────────────────────────────────

    function onSearchInput() {
        clearTimeout(_debounce ?? undefined)
        if (searchQuery.trim()) {
            mode = 'search'
            _debounce = setTimeout(doSearch, 350)
        } else {
            mode         = 'browse'
            _lastResults = null
            searchTotal  = 0
            searchPage   = 1
            searchResults = []
            _searchCache = new Map()
            saveState()
        }
    }

    function onSearchKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            searchQuery   = ''
            mode          = 'browse'
            _lastResults  = null
            searchTotal   = 0
            searchPage    = 1
            searchResults = []
            _searchCache  = new Map()
            saveState()
        }
    }

    async function doSearch() {
        const q = searchQuery.trim()
        if (!q) return
        searchPage    = 1
        searchTotal   = 0
        _lastResults  = null
        _searchCache  = new Map()
        searchLoading = true
        searchError   = null
        try {
            const res = await fetch(
                `/relay/api/discover/search?q=${encodeURIComponent(q)}&limit=${SEARCH_PAGE_SIZE}&offset=0`
            )
            if (res.status === 503) { searchError = 'Search index is still loading — try again in a moment.'; return }
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            _searchCache.set(1, data.results)
            searchTotal   = data.total
            searchResults = data.results
            _lastResults  = data.results
            saveState()
        } catch (err) {
            searchError = `Search unavailable: ${(err as Error).message}`
        } finally {
            searchLoading = false
        }
    }

    async function goSearchPage(dir: number) {
        const page = searchPage + dir
        if (_searchCache.has(page)) {
            searchPage    = page
            searchResults = _searchCache.get(page) ?? []
            _lastResults  = searchResults
            saveState()
            return
        }
        searchLoading = true
        searchError   = null
        try {
            const offset = (page - 1) * SEARCH_PAGE_SIZE
            const res = await fetch(
                `/relay/api/discover/search?q=${encodeURIComponent(searchQuery)}&limit=${SEARCH_PAGE_SIZE}&offset=${offset}`
            )
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            _searchCache.set(page, data.results)
            searchTotal   = data.total
            searchPage    = page
            searchResults = data.results
            _lastResults  = data.results
            saveState()
        } catch (err) {
            searchError = `Failed to load page ${page}: ${(err as Error).message}`
        } finally {
            searchLoading = false
        }
    }

    let searchPages = $derived(searchTotal > 0 ? Math.ceil(searchTotal / SEARCH_PAGE_SIZE) : 1)

    // ── Image error handler ───────────────────────────────────────────────────

    function onCardImgError(e: Event, appid: number) {
        const img = e.currentTarget as HTMLImageElement
        const capsule = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`
        if (img.src !== capsule) img.src = capsule
        else img.style.visibility = 'hidden'
    }

    // ── Keyboard navigation ───────────────────────────────────────────────────

    $effect(() => {
        function onKeydown(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement).tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
            if (mode === 'browse' && activeSection) {
                if (e.key === 'ArrowLeft'  && activeSection.page > 1)                   { loadFeaturedPage(featuredTab, activeSection.page - 1); return }
                if (e.key === 'ArrowRight' && activeSection.page < activeSection.pages) { loadFeaturedPage(featuredTab, activeSection.page + 1); return }
            } else if (mode === 'search') {
                if (e.key === 'ArrowLeft'  && searchPage > 1)           { goSearchPage(-1); return }
                if (e.key === 'ArrowRight' && searchPage < searchPages)  { goSearchPage(1);  return }
            }
            const scroller = document.getElementById('main-content')
            if (e.key === 'ArrowDown') { e.preventDefault(); scroller?.scrollBy({ top:  window.innerHeight, behavior: 'smooth' }) }
            if (e.key === 'ArrowUp')   { e.preventDefault(); scroller?.scrollBy({ top: -window.innerHeight, behavior: 'smooth' }) }
        }
        window.addEventListener('keydown', onKeydown)
        return () => window.removeEventListener('keydown', onKeydown)
    })

    // ── Mount ─────────────────────────────────────────────────────────────────

    onMount(() => {
        restoreState()
        loadOwnership()

        try {
            const cached = localStorage.getItem(BLOCKLIST_KEY)
            if (cached) titleBlocklist = JSON.parse(cached)
        } catch {}

        fetch('/api/settings')
            .then(res => res.ok ? res.json() : null)
            .then(s => {
                if (!s) return
                titleBlocklist = s.titleBlocklist ?? []
                try { localStorage.setItem(BLOCKLIST_KEY, JSON.stringify(titleBlocklist)) } catch {}
            })
            .catch(() => {})

        if (mode === 'search' && _lastResults !== null) {
            _searchCache = new Map([[searchPage, _lastResults]])
            searchResults = _lastResults
        } else {
            mode = 'browse'
            loadFeatured()
        }
    })
</script>

<div class="disc-wrap">
    <h1 class="disc-title">Discover</h1>

    <div class="disc-search-wrap">
        <input
            class="disc-search"
            type="search"
            placeholder="Search 160,000+ Steam games…"
            autocomplete="off"
            bind:value={searchQuery}
            oninput={onSearchInput}
            onkeydown={onSearchKeydown}
        >
    </div>

    <!-- Browse panel -->
    {#if mode === 'browse'}
    <div class="disc-browse">
        <div class="disc-tabs-bar">
            <div class="disc-tabs">
                {#each FEATURED_TABS as t}
                    <button
                        class="disc-tab"
                        class:disc-tab--active={featuredTab === t.id}
                        onclick={() => switchTab(t.id)}
                    >
                        <span class="disc-tab-full">{t.label}</span>
                        <span class="disc-tab-short">{t.short}</span>
                    </button>
                {/each}
            </div>
            {#if activeSection && activeSection.pages > 1}
                <div class="disc-top-pagination">
                    <button class="disc-page-btn" disabled={activeSection.page <= 1}
                        onclick={() => loadFeaturedPage(featuredTab, activeSection.page - 1)}>← Prev</button>
                    <span class="disc-page-info">Page {activeSection.page} of {activeSection.pages}</span>
                    <button class="disc-page-btn" disabled={activeSection.page >= activeSection.pages}
                        onclick={() => loadFeaturedPage(featuredTab, activeSection.page + 1)}>Next →</button>
                </div>
            {/if}
        </div>

        <div class="disc-grid">
            {#if featuredLoading}
                <div class="disc-loading">Loading…</div>
            {:else if featuredError}
                <div class="disc-empty disc-error">{featuredError}</div>
            {:else if !activeSection || !visibleBrowseItems.length}
                <div class="disc-empty">No results yet — check back soon.</div>
            {:else}
                {#each visibleBrowseItems as item}
                    {@const badge = owned.has(item.appid) ? 'owned' : wishlist.has(item.appid) ? 'wish' : null}
                    <div
                        class="lib-card disc-card"
                        tabindex="0"
                        onclick={() => navigate(`game/${item.appid}`)}
                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`game/${item.appid}`) } }}
                    >
                        <div class="lib-card-img-wrap">
                            <img
                                class="lib-card-img"
                                src={item.headerImage}
                                alt={item.name}
                                loading="lazy"
                                onerror={(e) => onCardImgError(e, item.appid)}
                            >
                            {#if badge}
                                <span class="disc-badge disc-badge--{badge}">{badge === 'owned' ? 'Owned' : 'Wishlisted'}</span>
                            {/if}
                        </div>
                        <div class="lib-card-info">
                            <span class="lib-card-name">{item.name}</span>
                            <div class="disc-price-row">
                                {#if item.isFree}
                                    <span class="disc-price disc-price--free">Free</span>
                                {:else if item.price != null}
                                    {#if (item.discount ?? 0) > 0 && item.originalPrice != null}
                                        <span class="disc-discount">-{item.discount}%</span>
                                        <span class="disc-price disc-price--was">${item.originalPrice.toFixed(2)}</span>
                                        <span class="disc-price">${item.price.toFixed(2)}</span>
                                    {:else}
                                        <span class="disc-price">${item.price.toFixed(2)}</span>
                                    {/if}
                                {/if}
                            </div>
                        </div>
                    </div>
                {/each}
                {#if activeSection.pages > 1}
                    <div class="disc-pagination" style="grid-column:1/-1">
                        <button class="disc-page-btn" disabled={activeSection.page <= 1}
                            onclick={() => loadFeaturedPage(featuredTab, activeSection.page - 1)}>← Prev</button>
                        <span class="disc-page-info">Page {activeSection.page} of {activeSection.pages}</span>
                        <button class="disc-page-btn" disabled={activeSection.page >= activeSection.pages}
                            onclick={() => loadFeaturedPage(featuredTab, activeSection.page + 1)}>Next →</button>
                    </div>
                {/if}
            {/if}
        </div>
    </div>

    <!-- Search panel -->
    {:else}
    <div class="disc-browse">
        <div class="disc-search-meta">
            {#if !searchLoading && searchTotal > 0}
                <span class="disc-result-count">{searchTotal.toLocaleString()} result{searchTotal !== 1 ? 's' : ''}</span>
                {#if searchPages > 1}
                    <div class="disc-top-pagination">
                        <button class="disc-page-btn" disabled={searchPage <= 1} onclick={() => goSearchPage(-1)}>← Prev</button>
                        <span class="disc-page-info">Page {searchPage} of {searchPages} <span class="disc-page-total">({searchTotal.toLocaleString()} results)</span></span>
                        <button class="disc-page-btn" disabled={searchPage >= searchPages} onclick={() => goSearchPage(1)}>Next →</button>
                    </div>
                {/if}
            {/if}
        </div>

        <div class="disc-grid">
            {#if searchLoading}
                <div class="disc-loading">Searching…</div>
            {:else if searchError}
                <div class="disc-empty disc-error">{searchError}</div>
            {:else if visibleSearchResults.length === 0 && searchQuery.trim()}
                <div class="disc-empty">No results for "{searchQuery}".</div>
            {:else}
                {#each visibleSearchResults as item}
                    {@const badge = owned.has(item.appid) ? 'owned' : wishlist.has(item.appid) ? 'wish' : null}
                    <div
                        class="lib-card disc-card"
                        tabindex="0"
                        onclick={() => navigate(`game/${item.appid}`)}
                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`game/${item.appid}`) } }}
                    >
                        <div class="lib-card-img-wrap">
                            <img
                                class="lib-card-img"
                                src={item.headerImage}
                                alt={item.name}
                                loading="lazy"
                                onerror={(e) => onCardImgError(e, item.appid)}
                            >
                            {#if badge}
                                <span class="disc-badge disc-badge--{badge}">{badge === 'owned' ? 'Owned' : 'Wishlisted'}</span>
                            {/if}
                        </div>
                        <div class="lib-card-info">
                            <span class="lib-card-name">{item.name}</span>
                            <div class="disc-price-row">
                                {#if item.isFree}
                                    <span class="disc-price disc-price--free">Free</span>
                                {:else if item.price != null}
                                    {#if (item.discount ?? 0) > 0 && item.originalPrice != null}
                                        <span class="disc-discount">-{item.discount}%</span>
                                        <span class="disc-price disc-price--was">${item.originalPrice.toFixed(2)}</span>
                                        <span class="disc-price">${item.price.toFixed(2)}</span>
                                    {:else}
                                        <span class="disc-price">${item.price.toFixed(2)}</span>
                                    {/if}
                                {/if}
                            </div>
                        </div>
                    </div>
                {/each}
                {#if searchPages > 1}
                    <div class="disc-pagination" style="grid-column:1/-1">
                        <button class="disc-page-btn" disabled={searchPage <= 1} onclick={() => goSearchPage(-1)}>← Prev</button>
                        <span class="disc-page-info">Page {searchPage} of {searchPages} <span class="disc-page-total">({searchTotal.toLocaleString()} results)</span></span>
                        <button class="disc-page-btn" disabled={searchPage >= searchPages} onclick={() => goSearchPage(1)}>Next →</button>
                    </div>
                {/if}
            {/if}
        </div>
    </div>
    {/if}
</div>
