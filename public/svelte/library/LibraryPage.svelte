<script>
    import { onMount }     from 'svelte'
    import { loadGameFilter } from '../../js/views/game-filter.js'
    import { setWithTTL, getWithTTL } from '../../js/storage.js'

    const PAGE_SIZE      = 48
    const STORAGE_SORT   = 'gj_lib_sort'
    const STORAGE_DIR    = 'gj_lib_dir'
    const STORAGE_PAGE   = 'gj_lib_page'
    const STORAGE_QUERY  = 'gj_lib_query'
    const STORAGE_SCROLL = 'gj_lib_scroll'
    const STORAGE_LETTER = 'gj_lib_letter'
    const ALPHA_CHARS    = ['A-Z', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

    let { scrollContainer = null } = $props()

    let all     = $state([])
    let loading = $state(true)
    let error   = $state(null)
    let query   = $state('')
    let sort    = $state('name')
    let dir     = $state('asc')
    let page    = $state(1)
    let letter  = $state(null)
    let debounce = null

    let available = $derived.by(() => {
        const q  = query.toLowerCase()
        const src = q ? all.filter(g => g.name.toLowerCase().includes(q)) : all
        const set = new Set()
        for (const g of src) {
            const first = g.name[0]?.toUpperCase()
            if (first && /[A-Z]/.test(first)) set.add(first)
            else if (first) set.add('#')
        }
        return set
    })

    let filtered = $derived.by(() => {
        const q   = query.toLowerCase()
        let res   = q ? all.filter(g => g.name.toLowerCase().includes(q)) : [...all]
        if      (letter === '#') res = res.filter(g => !/^[A-Za-z]/.test(g.name))
        else if (letter)         res = res.filter(g => g.name.toUpperCase().startsWith(letter))
        const flip = dir === 'asc' ? 1 : -1
        if      (sort === 'playtime') res.sort((a, b) => flip * ((a.playtime_forever ?? 0) - (b.playtime_forever ?? 0)))
        else if (sort === 'recent')   res.sort((a, b) => flip * ((a.rtime_last_played ?? 0) - (b.rtime_last_played ?? 0)))
        else                          res.sort((a, b) => flip * a.name.localeCompare(b.name))
        return res
    })

    let totalPages = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)))
    let pageSlice  = $derived(filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE))
    let subtitle   = $derived(
        query
            ? `${filtered.length} of ${all.length} games — page ${page} of ${totalPages}`
            : `${all.length} games — page ${page} of ${totalPages}`
    )

    function fmtPlaytime(minutes) {
        if (!minutes) return null
        const h = Math.floor(minutes / 60)
        return h === 0 ? `${minutes}m` : `${h.toLocaleString()} hrs`
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    function onSearchInput(e) {
        clearTimeout(debounce)
        debounce = setTimeout(() => {
            query  = e.target.value
            page   = 1
            setWithTTL(STORAGE_QUERY, query)
            setWithTTL(STORAGE_PAGE,  1)
        }, 200)
    }

    function onSortChange(e) {
        sort  = e.target.value
        dir   = sort === 'name' ? 'asc' : 'desc'
        page  = 1
        localStorage.setItem(STORAGE_SORT, sort)
        localStorage.setItem(STORAGE_DIR,  dir)
        setWithTTL(STORAGE_PAGE, 1)
    }

    function toggleDir() {
        dir  = dir === 'asc' ? 'desc' : 'asc'
        page = 1
        localStorage.setItem(STORAGE_DIR, dir)
        setWithTTL(STORAGE_PAGE, 1)
    }

    function onLetterClick(ch) {
        letter = ch === 'A-Z' ? null : ch
        page   = 1
        setWithTTL(STORAGE_LETTER, letter ?? '')
        setWithTTL(STORAGE_PAGE, 1)
    }

    function prevPage() {
        page--
        setWithTTL(STORAGE_PAGE, page)
        setWithTTL(STORAGE_SCROLL, 0)
        scrollContainer?.scrollTo(0, 0)
    }

    function nextPage() {
        page++
        setWithTTL(STORAGE_PAGE, page)
        setWithTTL(STORAGE_SCROLL, 0)
        scrollContainer?.scrollTo(0, 0)
    }

    // ── Scroll persistence ────────────────────────────────────────────────────

    $effect(() => {
        if (!scrollContainer) return
        let timer = null
        function onScroll() {
            clearTimeout(timer)
            timer = setTimeout(() => { setWithTTL(STORAGE_SCROLL, scrollContainer.scrollTop) }, 150)
        }
        scrollContainer.addEventListener('scroll', onScroll)
        return () => { clearTimeout(timer); scrollContainer.removeEventListener('scroll', onScroll) }
    })

    // ── Load ──────────────────────────────────────────────────────────────────

    onMount(async () => {
        const savedScroll = Number(getWithTTL(STORAGE_SCROLL) ?? 0)
        const savedPage   = Number(getWithTTL(STORAGE_PAGE)   ?? 1)

        try {
            const [gamesRes, shouldShow] = await Promise.all([
                fetch('/relay/api/steam/games'),
                loadGameFilter(),
            ])
            if (!gamesRes.ok) throw new Error(`Games HTTP ${gamesRes.status}`)
            const json = await gamesRes.json()
            const raw  = Array.isArray(json)                        ? json
                       : Array.isArray(json.games)                  ? json.games
                       : Array.isArray(json.data)                   ? json.data
                       : json.response && Array.isArray(json.response.games) ? json.response.games
                       : []
            all = raw.filter(g => shouldShow(g.appid))
        } catch (err) {
            error   = err.message
            loading = false
            return
        }

        query  = getWithTTL(STORAGE_QUERY)       ?? ''
        sort   = localStorage.getItem(STORAGE_SORT) ?? 'name'
        dir    = localStorage.getItem(STORAGE_DIR)  ?? 'asc'
        letter = getWithTTL(STORAGE_LETTER) || null
        loading = false

        page = Math.min(savedPage, totalPages) || 1
        if (savedScroll > 0) requestAnimationFrame(() => { if (scrollContainer) scrollContainer.scrollTop = savedScroll })
    })
</script>

{#if loading}
    <p class="page-loading">Loading library…</p>
{:else if error}
    <p class="page-error">Failed to load library: {error}</p>
{:else}
    <div class="page-header">
        <h1 class="page-title lib-title">Steam Library</h1>
        <p class="page-subtitle lib-subtitle">{subtitle}</p>
    </div>

    <div class="lib-controls">
        <input class="lib-search" type="search" placeholder="Search games…"
               value={query} autocomplete="off" oninput={onSearchInput}>
        <select class="lib-sort" value={sort} onchange={onSortChange}>
            <option value="name">A – Z</option>
            <option value="playtime">Most Played</option>
            <option value="recent">Recently Played</option>
        </select>
        <button class="lib-dir-btn" title={dir === 'asc' ? 'Ascending' : 'Descending'} onclick={toggleDir}>
            {dir === 'asc' ? '↑' : '↓'}
        </button>
        <div class="lib-pager">
            {#if totalPages > 1}
                <button class="lib-pager-btn" disabled={page <= 1} onclick={prevPage}>← Prev</button>
                <span class="lib-pager-info">Page {page} of {totalPages}</span>
                <button class="lib-pager-btn" disabled={page >= totalPages} onclick={nextPage}>Next →</button>
            {/if}
        </div>
    </div>

    <div class="lib-alpha">
        {#each ALPHA_CHARS as ch}
            <button class="lib-alpha-btn"
                    class:lib-alpha-btn--active={(letter === null && ch === 'A-Z') || letter === ch}
                    disabled={ch !== 'A-Z' && !available.has(ch)}
                    onclick={() => onLetterClick(ch)}>{ch}</button>
        {/each}
    </div>

    <div class="lib-grid">
        {#if pageSlice.length === 0}
            <p class="lib-empty">No games match your search.</p>
        {:else}
            {#each pageSlice as g (g.appid)}
                {@const timeStr = fmtPlaytime(g.playtime_forever ?? 0)}
                <a class="lib-card" href="/game/{g.appid}">
                    <div class="lib-card-img-wrap">
                        <img class="lib-card-img"
                             src="/relay/images/steam/games/{g.appid}/header.jpg"
                             alt={g.name} loading="lazy">
                    </div>
                    <div class="lib-card-info">
                        <span class="lib-card-name">{g.name}</span>
                        {#if timeStr}
                            <span class="lib-card-hours">{timeStr}</span>
                        {:else}
                            <span class="lib-card-hours lib-card-hours--zero">Not played</span>
                        {/if}
                    </div>
                </a>
            {/each}
        {/if}
    </div>

    <div class="lib-bottom-row">
        <button class="lib-back-top" onclick={() => scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' })}>
            ↑ Back to top
        </button>
        <div class="lib-pager">
            {#if totalPages > 1}
                <button class="lib-pager-btn" disabled={page <= 1} onclick={prevPage}>← Prev</button>
                <span class="lib-pager-info">Page {page} of {totalPages}</span>
                <button class="lib-pager-btn" disabled={page >= totalPages} onclick={nextPage}>Next →</button>
            {/if}
        </div>
    </div>
{/if}
