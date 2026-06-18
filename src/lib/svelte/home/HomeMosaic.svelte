<script lang="ts">
    let { posters }: { posters: string[] } = $props()

    interface Slot {
        front:     string
        back:      string
        flipClass: '' | 'flip-x' | 'flip-y'
        axis:      'X' | 'Y'
        delay:     number   // animation-delay in ms for the stagger effect
    }

    let slots     = $state<Slot[]>([])
    let available: string[] = []

    $effect(() => {
        const all = posters
        if (!all.length) return

        const copy = [...all]
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]]
        }

        slots     = copy.slice(0, 6).map(url => ({ front: url, back: url, flipClass: '' as const, axis: 'Y' as const, delay: 0 }))
        available = copy.slice(6)

        const interval = setInterval(tick, 4000)
        return () => clearInterval(interval)
    })

    function tick() {
        if (available.length < 6) return

        const pool = [...available]
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]]
        }
        const picked = pool.slice(0, 6)
        available = [...pool.slice(6), ...slots.map(s => s.front)]

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
        const { back, axis } = slots[i]
        slots[i] = { front: back, back, flipClass: '', axis, delay: 0 }
    }
</script>

<div class="home-mosaic">
    {#each slots as slot, i (i)}
        <div class="mosaic-cell">
            <div class="mosaic-cell-inner {slot.flipClass}"
                 style:animation-delay="{slot.delay}ms"
                 onanimationend={() => onFlipEnd(i)}>
                <img class="mosaic-face mosaic-face--front"
                     src={slot.front}
                     alt=""
                     loading={i < 3 ? 'eager' : 'lazy'}
                     onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}>
                <img class="mosaic-face mosaic-face--back"
                     src={slot.back}
                     alt=""
                     loading="lazy"
                     style:transform={`rotate${slot.axis}(180deg)`}
                     onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}>
            </div>
        </div>
    {/each}
</div>
