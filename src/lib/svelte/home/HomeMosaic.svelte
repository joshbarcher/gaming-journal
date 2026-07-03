<script lang="ts">
    interface Poster { appid: number; poster: string }

    let { posters, cols = 3 }: { posters: Poster[]; cols?: 2 | 3 } = $props()

    interface Slot {
        front:     Poster
        back:      Poster
        flipClass: '' | 'flip-x' | 'flip-y'
        axis:      'X' | 'Y'
        delay:     number   // animation-delay in ms for the stagger effect
    }

    const INTERVAL   = 8000
    const PRELOAD_AT = 2000  // ms after a flip to preload the next batch

    let slots     = $state<Slot[]>([])
    let available: Poster[] = []

    const preloaded = new Set<string>()

    function preload(posters: Poster[]) {
        for (const p of posters) {
            if (preloaded.has(p.poster)) continue
            preloaded.add(p.poster)
            const img = new Image()
            img.src = p.poster
        }
    }

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

        // Preload the initial available pool right away so first flip is instant.
        preload(available.slice(0, 12))

        const interval = setInterval(tick, INTERVAL)
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

        // Preload the next likely batch while the current flip animation plays.
        setTimeout(() => preload(available.slice(0, 12)), PRELOAD_AT)
    }

    function onFlipEnd(i: number) {
        if (!slots[i].flipClass) return
        const { front, back, axis } = slots[i]
        available = [...available, front]
        slots[i] = { front: back, back, flipClass: '', axis, delay: 0 }
    }

</script>

<div class="home-mosaic" class:home-mosaic--landscape={cols === 2} style:grid-template-columns="repeat({cols}, 1fr)" style:grid-template-rows="repeat({cols === 2 ? 3 : 2}, 1fr)">
    {#each slots as slot, i (i)}
        <a class="mosaic-cell" href="/game/{slot.front.appid}" data-game-card data-appid={slot.front.appid}>
            <div class="mosaic-cell-inner {slot.flipClass}"
                 style:animation-delay="{slot.delay}ms"
                 onanimationend={() => onFlipEnd(i)}>
                <img class="mosaic-face mosaic-face--front"
                     src={slot.front.poster}
                     alt=""
                     loading={i < 3 ? 'eager' : 'lazy'}>
                <img class="mosaic-face mosaic-face--back"
                     src={slot.back.poster}
                     alt=""
                     loading="eager"
                     style:transform={`rotate${slot.axis}(180deg)`}>
            </div>
        </a>
    {/each}
</div>
