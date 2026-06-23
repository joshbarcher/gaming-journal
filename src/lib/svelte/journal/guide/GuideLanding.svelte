<script lang="ts">
    interface CoverImage { section: string; src: string }

    let { steamId, source, guideId, title, pageCount, parsedAt, coverImages, onStart }: {
        steamId:     string
        source:      string
        guideId:     string
        title:       string
        pageCount:   number
        parsedAt:    string | null
        coverImages: CoverImage[]
        onStart:     () => void
    } = $props()

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
    let available: CoverImage[] = []

    $effect(() => {
        const imgs = coverImages
        if (imgs.length < 4) return

        const copy = [...imgs].sort(() => Math.random() - 0.5)
        const take = Math.min(6, copy.length)
        slots     = copy.slice(0, take).map(img => ({ front: img, back: img, flipClass: '' as const, axis: 'Y' as const, delay: 0 }))
        available = copy.slice(take)

        const iv = setInterval(tick, INTERVAL)
        return () => clearInterval(iv)
    })

    function tick() {
        if (!slots.length) return
        const frontSet = new Set(slots.map(s => s.front.src))
        const pool     = [...(available.filter(p => !frontSet.has(p.src)).length >= slots.length
                             ? available.filter(p => !frontSet.has(p.src))
                             : available)].sort(() => Math.random() - 0.5)
        if (pool.length < slots.length) return
        const picked = pool.slice(0, slots.length)
        available = available.filter(p => !picked.some(q => q.src === p.src))
        slots = slots.map((slot, i) => {
            const axis: 'X' | 'Y' = Math.random() < 0.5 ? 'X' : 'Y'
            return { front: slot.front, back: picked[i], flipClass: axis === 'X' ? 'flip-x' : 'flip-y', axis, delay: Math.floor(Math.random() * 450) }
        })
    }

    function onFlipEnd(i: number) {
        if (!slots[i].flipClass) return
        const { front, back, axis } = slots[i]
        available = [...available, front]
        slots[i]  = { front: back, back, flipClass: '', axis, delay: 0 }
    }

    // ── Image URL ──────────────────────────────────────────────────────────────

    function imgUrl(img: CoverImage): string {
        const filename = img.src.replace(/^img\//, '').replace(/\.[^.]+$/, '.webp')
        return `/relay/guides-img/${steamId}/${source}/${guideId}/${encodeURIComponent(img.section)}/img/${filename}`
    }

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
        {#if parsedDate}
            <span class="gl-pill">Synced {parsedDate}</span>
        {/if}
    </div>

    <!-- Start button -->
    <button class="gl-start-btn" onclick={onStart}>
        Start Reading
        <span class="gl-start-arrow">→</span>
    </button>

    <!-- Mosaic -->
    {#if slots.length >= 4}
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
