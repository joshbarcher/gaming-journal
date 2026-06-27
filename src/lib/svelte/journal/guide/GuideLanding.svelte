<script lang="ts">
    import Fuse from 'fuse.js'

    interface CoverImage { section: string; src: string }
    interface FtEntry   { slug: string; label: string; text: string }
    interface HitSnippet { html: string }
    interface HitGroup  { slug: string; label: string; snippets: HitSnippet[] }

    let { steamId, source, guideId, title, pageCount, parsedAt, sizeBytes, sourceUrl, coverImages, onStart, onNav }: {
        steamId:     string
        source:      string
        guideId:     string
        title:       string
        pageCount:   number
        parsedAt:    string | null
        sizeBytes?:  number
        sourceUrl?:  string | null
        coverImages: CoverImage[]
        onStart:     () => void
        onNav:       (slug: string) => void
    } = $props()

    function fmtBytes(n: number | undefined): string {
        if (!n) return ''
        if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
        return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    // ── Mosaic (same flip logic as HomeMosaic) ─────────────────────────────────

    interface Slot {
        front:     CoverImage
        back:      CoverImage
        flipClass: '' | 'flip-x' | 'flip-y'
        axis:      'X' | 'Y'
        delay:     number
    }

    const INTERVAL = 5000

    let slots     = $state<Slot[]>([])
    let allImages: CoverImage[] = []

    $effect(() => {
        const imgs = coverImages
        if (imgs.length < 6) return

        allImages = [...imgs]
        const initial = [...allImages].sort(() => Math.random() - 0.5).slice(0, 6)
        slots = initial.map(img => ({ front: img, back: img, flipClass: '' as const, axis: 'Y' as const, delay: 0 }))

        const iv = setInterval(tick, INTERVAL)
        return () => clearInterval(iv)
    })

    function tick() {
        if (!slots.length) return

        // Shuffle all images, pick 6, ensure no slot gets its current image
        let pool = [...allImages].sort(() => Math.random() - 0.5).slice(0, 6)
        for (let i = 0; i < pool.length; i++) {
            if (pool[i].src === slots[i].front.src) {
                const j = (i + 1) % pool.length
                ;[pool[i], pool[j]] = [pool[j], pool[i]]
            }
        }

        slots = slots.map((slot, i) => {
            const axis: 'X' | 'Y' = Math.random() < 0.5 ? 'X' : 'Y'
            return { front: slot.front, back: pool[i], flipClass: axis === 'X' ? 'flip-x' : 'flip-y', axis, delay: Math.floor(Math.random() * 450) }
        })
    }

    function onFlipEnd(i: number) {
        if (!slots[i].flipClass) return
        const { back, axis } = slots[i]
        slots[i] = { front: back, back, flipClass: '', axis, delay: 0 }
    }

    // ── Image URL ──────────────────────────────────────────────────────────────

    function imgUrl(img: CoverImage): string {
        const filename = img.src.replace(/^img\//, '').replace(/\.[^.]+$/, '.webp')
        return `/relay/guides-img/${steamId}/${source}/${guideId}/${encodeURIComponent(img.section)}/img/${filename}`
    }

    // ── Full-text search ────────────────────────────────────────────────────────

    let query       = $state('')
    let hits        = $state<HitGroup[]>([])
    let searchReady = $state(false)
    let fuseInst: Fuse<FtEntry> | null = null

    function esc(s: string) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    }

    function makeSnippet(text: string, indices: readonly [number, number][]): string {
        if (!indices?.length) return esc(text.slice(0, 160))
        const R = 80
        const [s, e] = indices[0]
        const from = Math.max(0, s - R)
        const to   = Math.min(text.length, e + 1 + R)
        return (from > 0 ? '…' : '') +
            esc(text.slice(from, s)) +
            `<mark>${esc(text.slice(s, e + 1))}</mark>` +
            esc(text.slice(e + 1, to)) +
            (to < text.length ? '…' : '')
    }

    async function loadIndex() {
        if (fuseInst) return
        try {
            const data: FtEntry[] = await fetch(
                `/relay/api/guides/${steamId}/${source}/${encodeURIComponent(guideId)}/fulltext`
            ).then(r => r.ok ? r.json() : [])
            fuseInst = new Fuse(data, {
                keys: ['text'],
                includeMatches: true,
                includeScore: true,
                threshold: 0.3,
                minMatchCharLength: 3,
                ignoreLocation: true,
            })
            searchReady = true
        } catch { /* index unavailable */ }
    }

    function runSearch(q: string) {
        if (!fuseInst || !q.trim()) { hits = []; return }
        const raw = fuseInst.search(q.trim(), { limit: 60 })
        // Group by slug, max 3 snippets per page, max 6 pages
        const groups = new Map<string, HitGroup>()
        for (const r of raw) {
            const { slug, label, text } = r.item
            const indices = r.matches?.[0]?.indices ?? []
            if (!groups.has(slug)) {
                if (groups.size >= 6) continue
                groups.set(slug, { slug, label, snippets: [] })
            }
            const g = groups.get(slug)!
            if (g.snippets.length < 3) {
                g.snippets.push({ html: makeSnippet(text, indices as [number,number][]) })
            }
        }
        hits = [...groups.values()]
    }

    let debounceTimer: ReturnType<typeof setTimeout>
    function onInput() {
        clearTimeout(debounceTimer)
        if (!searchReady) { loadIndex(); return }
        debounceTimer = setTimeout(() => runSearch(query), 180)
    }

    $effect(() => {
        if (searchReady && query) runSearch(query)
    })

    // ── Stats ──────────────────────────────────────────────────────────────────

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN' }

    let parsedDate = $derived.by(() => {
        if (!parsedAt) return null
        try { return new Date(parsedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
        catch { return null }
    })
</script>

<div class="gl-landing">

    <!-- Big title -->
    <h2 class="gl-title">{title}</h2>

    <!-- Pills row: source + stats -->
    <div class="gl-pills">
        <span class="gl-pill gl-pill--source">{SOURCE_LABELS[source] ?? source}</span>
        <span class="gl-pill">{pageCount} pages</span>
        {#if sizeBytes}
            <span class="gl-pill">{fmtBytes(sizeBytes)}</span>
        {/if}
        {#if parsedDate}
            <span class="gl-pill">Synced {parsedDate}</span>
        {/if}
        {#if sourceUrl}
            <a class="gl-pill gl-pill--link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
                View original
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            </a>
        {/if}
    </div>

    <!-- Full-text search -->
    <div class="gl-search">
        <div class="gl-search-bar">
            <span class="gl-search-icon">⌕</span>
            <input
                class="gl-search-input"
                type="search"
                placeholder="Search guide…"
                bind:value={query}
                onfocus={loadIndex}
                oninput={onInput}
                autocomplete="off"
                spellcheck="false"
            />
            {#if !searchReady && query}
                <span class="gl-search-loading">…</span>
            {/if}
        </div>

        {#if hits.length > 0}
            <div class="gl-search-results">
                {#each hits as group}
                    <div class="gl-sr-group">
                        <button class="gl-sr-page" onclick={() => onNav(group.slug)}>
                            {group.label}
                        </button>
                        {#each group.snippets as snippet}
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                            <p class="gl-sr-snippet">{@html snippet.html}</p>
                        {/each}
                    </div>
                {/each}
            </div>
        {:else if query.trim() && searchReady}
            <p class="gl-search-empty">No results for "{query}"</p>
        {/if}
    </div>

    <!-- Mosaic -->
    {#if slots.length >= 6}
        <div class="gl-mosaic" style:grid-template-columns="repeat({Math.min(slots.length, 3)}, 1fr)">
            {#each slots as slot, i (i)}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="mosaic-cell gl-mosaic-cell">
                    <div class="mosaic-cell-inner {slot.flipClass}"
                         style:animation-delay="{slot.delay}ms"
                         onanimationend={() => onFlipEnd(i)}>
                        <img class="mosaic-face mosaic-face--front"
                             src={imgUrl(slot.front)} alt="" loading={i < 3 ? 'eager' : 'lazy'}>
                        <img class="mosaic-face mosaic-face--back"
                             src={imgUrl(slot.back)} alt="" loading="eager"
                             style:transform={`rotate${slot.axis}(180deg)`}>
                    </div>
                </div>
            {/each}
        </div>
    {/if}

</div>
