<script>
    import { onMount } from 'svelte'
    import { navigate } from '../../js/router.js'

    const FEATURED_TABS = [
        { id: 'new_releases', label: 'New Releases' },
        { id: 'top_sellers',  label: 'Top Sellers'  },
        { id: 'coming_soon',  label: 'Coming Soon'  },
        { id: 'specials',     label: 'On Sale'       },
    ]
    const STORAGE_KEY      = 'disc-state'
    const SEARCH_PAGE_SIZE = 40
    const TTL_24H          = 24 * 60 * 60 * 1000

    // ── State ──────────────────────────────────────────────────────────────────

    let mode         = $state('browse')
    let featuredTab  = $state('new_releases')
    let searchQuery  = $state('')
    let featuredData = $state(null)
    let tabPages     = $state({})
    let owned        = $state(new Set())
    let wishlist     = $state(new Set())

    // Search state
    let searchResults  = $state([])
    let searchTotal    = $state(0)
    let searchPage     = $state(1)
    let searchLoading  = $state(false)
    let searchError    = $state(null)

    // Featured loading
    let featuredLoading = $state(false)
    let featuredError   = $state(null)

    // Non-reactive
    let _searchCache  = new Map()
    let _debounce     = null
    let _lastResults  = null  // persisted to localStorage for back-nav

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
            const o = new Set(), w = new Set()
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

    async function loadFeaturedPage(tab, page) {
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

    function switchTab(tab) {
        featuredTab = tab
        saveState()
        const existing = featuredData?.find(s => s.id === tab)
        if (!existing) loadFeaturedPage(tab, tabPages[tab] ?? 1)
    }

    let activeSection = $derived(featuredData?.find(s => s.id === featuredTab) ?? null)

    // ── Search ────────────────────────────────────────────────────────────────

    function onSearchInput() {
        clearTimeout(_debounce)
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

    function onSearchKeydown(e) {
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
            searchError = `Search unavailable: ${err.message}`
        } finally {
            searchLoading = false
        }
    }

    async function goSearchPage(dir) {
        const page = searchPage + dir
        if (_searchCache.has(page)) {
            searchPage    = page
            searchResults = _searchCache.get(page)
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
            searchError = `Failed to load page ${page}: ${err.message}`
        } finally {
            searchLoading = false
        }
    }

    let searchPages = $derived(searchTotal > 0 ? Math.ceil(searchTotal / SEARCH_PAGE_SIZE) : 1)

    // ── Image error handler ───────────────────────────────────────────────────

    function onCardImgError(e, appid) {
        const capsule = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`
        if (e.currentTarget.src !== capsule) e.currentTarget.src = capsule
        else e.currentTarget.style.visibility = 'hidden'
    }

    // ── Mount ─────────────────────────────────────────────────────────────────

    onMount(() => {
        restoreState()
        loadOwnership()

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
                    >{t.label}</button>
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
            {:else if !activeSection || !activeSection.items?.length}
                <div class="disc-empty">No results yet — check back soon.</div>
            {:else}
                {#each activeSection.items as item}
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
                                    {#if item.discount > 0 && item.originalPrice != null}
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
            {:else if searchResults.length === 0 && searchQuery.trim()}
                <div class="disc-empty">No results for "{searchQuery}".</div>
            {:else}
                {#each searchResults as item}
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
                                    {#if item.discount > 0 && item.originalPrice != null}
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
