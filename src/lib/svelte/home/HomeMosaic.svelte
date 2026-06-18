<script lang="ts">
    interface Poster { poster: string; header: string }

    let { posters }: { posters: Poster[] } = $props()

    interface Slot {
        front:     Poster
        back:      Poster
        flipClass: '' | 'flip-x' | 'flip-y'
        axis:      'X' | 'Y'
        delay:     number   // animation-delay in ms for the stagger effect
    }

    let slots     = $state<Slot[]>([])
    let available: Poster[] = []

    $effect(() => {
        const all = posters
        if (all.length < 12) return

        const copy = [...all]
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]]
        }

        slots     = copy.slice(0, 6).map(p => ({ front: p, back: p, flipClass: '' as const, axis: 'Y' as const, delay: 0 }))
        available = copy.slice(6)

        const interval = setInterval(tick, 4000)
        return () => clearInterval(interval)
    })

    function tick() {
        if (available.length < 6) return

        // Exclude images currently showing as fronts — they can't safely appear as
        // backs in other slots without causing a visible duplicate.
        const frontPosters = new Set(slots.map(s => s.front.poster))
        const eligible     = available.filter(p => !frontPosters.has(p.poster))
        const source       = eligible.length >= 6 ? eligible : available

        const pool = [...source]
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]]
        }
        const picked    = pool.slice(0, 6)
        const pickedSet = new Set(picked.map(p => p.poster))
        // Remove picked items from available — old fronts are returned in onFlipEnd
        // once each flip animation completes, not all at once here.
        available = available.filter(p => !pickedSet.has(p.poster))

        // Each tile gets a random stagger delay (0–450ms) — "breeze over water" feel.
        // Delays are independent of the interval so they can't drift the next tick.
        slots = slots.map((slot, i) => {
            const axis: 'X' | 'Y' = Math.random() < 0.5 ? 'X' : 'Y'
            const delay = Math.floor(Math.random() * 450)
            return { front: slot.front, back: picked[i], flipClass: axis === 'X' ? 'flip-x' : 'flip-y', axis, delay }
        })
    }

    function onFlipEnd(i: number) {
        if (!slots[i].flipClass) return
        const { front, back, axis } = slots[i]
        available = [...available, front]
        slots[i] = { front: back, back, flipClass: '', axis, delay: 0 }
    }

    function onImgError(e: Event) {
        const img = e.currentTarget as HTMLImageElement
        const fb  = img.dataset.fallback
        if (fb && img.src !== fb) {
            img.src = fb
        } else {
            img.style.visibility = 'hidden'
        }
    }
</script>

<div class="home-mosaic">
    {#each slots as slot, i (i)}
        <div class="mosaic-cell">
            <div class="mosaic-cell-inner {slot.flipClass}"
                 style:animation-delay="{slot.delay}ms"
                 onanimationend={() => onFlipEnd(i)}>
                <img class="mosaic-face mosaic-face--front"
                     src={slot.front.poster}
                     data-fallback={slot.front.header}
                     alt=""
                     loading={i < 3 ? 'eager' : 'lazy'}
                     onerror={onImgError}>
                <img class="mosaic-face mosaic-face--back"
                     src={slot.back.poster}
                     data-fallback={slot.back.header}
                     alt=""
                     loading="lazy"
                     style:transform={`rotate${slot.axis}(180deg)`}
                     onerror={onImgError}>
            </div>
        </div>
    {/each}
</div>
