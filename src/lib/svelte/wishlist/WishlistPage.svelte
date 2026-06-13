<script lang="ts">
    import { onMount }     from 'svelte'
    import { loadGameFilter } from '../../js/views/game-filter.js'
    import { setWithTTL, getWithTTL } from '../../js/storage.js'

    const PAGE_SIZE      = 48
    const STORAGE_SORT   = 'gj_wl_sort'
    const STORAGE_DIR    = 'gj_wl_dir'
    const STORAGE_PAGE   = 'gj_wl_page'
    const STORAGE_SCROLL = 'gj_wl_scroll'
    const STORAGE_LETTER = 'gj_wl_letter'
    const ALPHA_CHARS    = ['A-Z', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

    let { scrollContainer = null } = $props()

    import type { SteamGame } from '../../types.js'
    let all             = $state<SteamGame[]>([])
    let loading         = $state(true)
    let error           = $state<string | null>(null)
    let query           = $state('')
    let sort            = $state('priority')
    let dir             = $state('asc')
    let page            = $state(1)
    let letter          = $state<string | null>(null)
    let hideUnavailable = $state(false)
    let debounce: ReturnType<typeof setTimeout> | null = null

    let available = $derived.by(() => {
        const q   = query.toLowerCase()
        const src = hideUnavailable ? all.filter(g => !g.store?.unavailable) : all
        const searched = q ? src.filter(g => g.name.toLowerCase().includes(q)) : src
        const set = new Set()
        for (const g of searched) {
            const first = g.name[0]?.toUpperCase()
            if (first && /[A-Z]/.test(first)) set.add(first)
            else if (first) set.add('#')
        }
        return set
    })

    let filtered = $derived.by(() => {
        const q   = query.toLowerCase()
        const src = hideUnavailable ? all.filter(g => !g.store?.unavailable) : all
        let res   = q ? src.filter(g => g.name.toLowerCase().includes(q)) : [...src]
        if      (letter === '#') res = res.filter(g => !/^[A-Za-z]/.test(g.name))
        else if (letter)         res = res.filter(g => g.name.toUpperCase().startsWith(letter!))

        const flip = dir === 'asc' ? 1 : -1
        res.sort((a, b) => {
            switch (sort) {
                case 'price': {
                    const pa = a.itad?.bestPrice?.price ?? Infinity
                    const pb = b.itad?.bestPrice?.price ?? Infinity
                    return flip * (pa - pb)
                }
                case 'discount': {
                    return flip * ((a.itad?.bestPrice?.cut ?? 0) - (b.itad?.bestPrice?.cut ?? 0))
                }
                case 'added': {
                    return flip * ((a.wishlist?.dateAdded ?? 0) - (b.wishlist?.dateAdded ?? 0))
                }
                case 'release': {
                    const fallback = flip === -1 ? '9999-99-99' : '0000-00-00'
                    const ra = a.store?.releaseDateIso ?? (a.store?.comingSoon ? '9999-99-99' : fallback)
                    const rb = b.store?.releaseDateIso ?? (b.store?.comingSoon ? '9999-99-99' : fallback)
                    return flip * ra.localeCompare(rb)
                }
                case 'priority': {
                    return flip * ((a.wishlist?.priority ?? 9999) - (b.wishlist?.priority ?? 9999))
                }
                default:
                    return flip * a.name.localeCompare(b.name)
            }
        })
        return res
    })

    let totalPages = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)))
    let pageSlice  = $derived(filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE))
    let subtitle   = $derived(
        query
            ? `${filtered.length} of ${all.length} games — page ${page} of ${totalPages}`
            : `${all.length} games — page ${page} of ${totalPages}`
    )

    // ── Event handlers ────────────────────────────────────────────────────────

    function onSearchInput(e: Event) {
        clearTimeout(debounce ?? undefined)
        debounce = setTimeout(() => {
            query = (e.target as HTMLInputElement).value
            page  = 1
            localStorage.removeItem(STORAGE_SCROLL)
        }, 200)
    }

    function onSortChange(e: Event) {
        sort = (e.target as HTMLSelectElement).value
        dir  = (sort === 'discount' || sort === 'release') ? 'desc' : 'asc'
        page = 1
        localStorage.setItem(STORAGE_SORT, sort)
        localStorage.setItem(STORAGE_DIR,  dir)
        localStorage.removeItem(STORAGE_SCROLL)
    }

    function toggleDir() {
        dir  = dir === 'asc' ? 'desc' : 'asc'
        page = 1
        localStorage.setItem(STORAGE_DIR, dir)
        localStorage.removeItem(STORAGE_SCROLL)
    }

    function onLetterClick(ch: string) {
        letter = ch === 'A-Z' ? null : ch
        page   = 1
        setWithTTL(STORAGE_LETTER, letter ?? '')
        setWithTTL(STORAGE_PAGE, 1)
        localStorage.removeItem(STORAGE_SCROLL)
    }

    function prevPage() {
        page--
        setWithTTL(STORAGE_PAGE, String(page))
        localStorage.removeItem(STORAGE_SCROLL)
        scrollContainer?.scrollTo(0, 0)
    }

    function nextPage() {
        page++
        setWithTTL(STORAGE_PAGE, String(page))
        localStorage.removeItem(STORAGE_SCROLL)
        scrollContainer?.scrollTo(0, 0)
    }

    // ── Scroll persistence ────────────────────────────────────────────────────

    $effect(() => {
        if (!scrollContainer) return
        let timer: ReturnType<typeof setTimeout> | null = null
        function onScroll() {
            clearTimeout(timer ?? undefined)
            timer = setTimeout(() => { setWithTTL(STORAGE_SCROLL, String(Math.round(scrollContainer.scrollTop))) }, 150)
        }
        scrollContainer.addEventListener('scroll', onScroll, { passive: true })
        return () => { clearTimeout(timer ?? undefined); scrollContainer.removeEventListener('scroll', onScroll) }
    })

    // ── Load ──────────────────────────────────────────────────────────────────

    onMount(async () => {
        const savedScroll = parseInt(String(getWithTTL(STORAGE_SCROLL) ?? '0'), 10) || 0
        const savedPage   = parseInt(String(getWithTTL(STORAGE_PAGE)   ?? '1'), 10) || 1

        try {
            const [res, shouldShow, settingsRes] = await Promise.all([
                fetch('/relay/api/wishlist'),
                loadGameFilter(),
                fetch('/api/settings'),
            ])
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const raw      = await res.json()
            const settings = settingsRes.ok ? await settingsRes.json() : {}
            hideUnavailable = settings.hideUnavailable === true
            all = (raw as SteamGame[]).filter(g => shouldShow(g.appid))
        } catch (err) {
            error   = (err as Error).message
            loading = false
            return
        }

        sort   = localStorage.getItem(STORAGE_SORT) ?? 'priority'
        dir    = localStorage.getItem(STORAGE_DIR)  ?? 'asc'
        letter = (getWithTTL(STORAGE_LETTER) as string) || null
        // query intentionally not persisted — reset to '' each visit
        loading = false

        page = Math.min(savedPage, totalPages) || 1
        if (savedScroll > 0) requestAnimationFrame(() => { if (scrollContainer) scrollContainer.scrollTop = savedScroll })
    })
</script>

{#if loading}
    <p class="page-loading">Loading wishlist…</p>
{:else if error}
    <p class="page-error">Failed to load wishlist: {error}</p>
{:else}
    <div class="page-header">
        <h1 class="page-title lib-title">Wishlist</h1>
        <p class="page-subtitle lib-subtitle">{subtitle}</p>
    </div>

    <div class="lib-controls">
        <input class="lib-search" type="search" placeholder="Search wishlist…"
               value={query} autocomplete="off" oninput={onSearchInput}>
        <select class="lib-sort" value={sort} onchange={onSortChange}>
            <option value="priority">Priority</option>
            <option value="name">A – Z</option>
            <option value="price">Price</option>
            <option value="discount">Discount</option>
            <option value="added">Date Added</option>
            <option value="release">Release Date</option>
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
                {@const bp          = g.itad?.bestPrice}
                {@const retail      = g.store?.price}
                {@const onSale      = (bp?.cut ?? 0) > 0}
                <a class="lib-card" class:lib-card--unavailable={g.store?.unavailable} href="/game/{g.appid}">
                    <div class="lib-card-img-wrap">
                        <img class="lib-card-img"
                             src="/relay/images/steam/games/{g.appid}/header.jpg"
                             alt={g.name} loading="lazy">
                        {#if g.store?.unavailable}
                            <span class="wl-card-unavailable">Unavailable</span>
                        {/if}
                        {#if g.wishlist?.local}
                            <span class="wl-card-local">Local Wishlist</span>
                        {/if}
                        {#if g.flags?.alert}
                            <span class="wl-card-alert" class:wl-card-alert--active={onSale}>
                                <svg class="wl-alert-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                                </svg>
                                {onSale ? 'ON SALE' : 'Watching'}
                            </span>
                        {/if}
                    </div>
                    <div class="lib-card-info">
                        <span class="lib-card-name">{g.name}</span>
                        {#if bp}
                            <p class="wl-card-price-line">
                                <span class="wl-card-price">{bp.price === 0 ? 'Free' : `$${bp.price.toFixed(2)}`}</span>
                                <span class="wl-card-sep">·</span>
                                <span class="wl-card-store">{bp.store}</span>
                                {#if bp.cut > 0}<span class="wl-card-cut">-{bp.cut}%</span>{/if}
                            </p>
                        {:else if g.store?.isFree}
                            <p class="wl-card-price-line"><span class="wl-card-price">Free</span></p>
                        {:else if retail}
                            <p class="wl-card-price-line"><span class="wl-card-price wl-card-price--retail">{retail.final_formatted}</span></p>
                        {:else}
                            <p class="wl-card-price-line wl-card-price--none">No price data</p>
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
