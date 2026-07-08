<script lang="ts">
    interface GuideInfo {
        source:      string
        guideId:     string
        title:       string
        sourceUrl:   string | null
        pageCount:   number
        screenshot:  string | null
        screenshots: string[]
    }

    let { appid, name, header, guide }: {
        appid:  number
        name:   string
        header: string
        guide:  GuideInfo
    } = $props()

    const SOURCE_LABELS: Record<string, string> = {
        gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8',
        gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker',
    }
    const SOURCE_ICONS: Record<string, string> = {
        gamefaqs: '/images/guides/gamefaqs.webp', ign: '/images/guides/ign.webp',
        steam: '/images/guides/steam.webp', game8: '/images/guides/game8.webp',
        gamerguides: '/images/guides/gamerguides.webp', fandom: '/images/guides/fandom.webp',
        neoseeker: '/images/guides/neoseeker.webp',
    }

    const label = $derived(SOURCE_LABELS[guide.source] ?? guide.source)
    const icon  = $derived(SOURCE_ICONS[guide.source] ?? null)

    // Screenshots to cross-fade through; empty for text guides (GameFAQs) → header fallback.
    const shots = $derived(guide.screenshots?.length ? guide.screenshots : (guide.screenshot ? [guide.screenshot] : []))
    // Two landscape panes when there are enough distinct frames to fill both.
    const dual  = $derived(shots.length >= 2)

    // Left and right panes each cycle through the frames, offset so they differ,
    // and change in a staggered "wave" — left first, then right ~700ms later.
    let idxL = $state(0)
    let idxR = $state(0)

    $effect(() => {
        if (!dual) return
        idxL = 0
        idxR = Math.floor(shots.length / 2)
        let pending: ReturnType<typeof setTimeout> | undefined
        const iv = setInterval(() => {
            idxL = (idxL + 1) % shots.length
            pending = setTimeout(() => { idxR = (idxR + 1) % shots.length }, 700)
        }, 5000)
        return () => { clearInterval(iv); if (pending) clearTimeout(pending) }
    })
</script>

<a class="home-card home-card--guide"
   href="/journal/{appid}/guides/{guide.source}/{guide.guideId}"
   data-game-card data-appid={appid} data-game-name={name}>

    <div class="home-guide-head">
        {#if icon}
            <img class="home-guide-icon" src={icon} alt="">
        {/if}
        <div class="home-guide-text">
            <span class="home-guide-source">{label} Guide</span>
            <span class="home-guide-title">{guide.title}</span>
            <span class="home-guide-meta">Continue reading →</span>
        </div>
    </div>

    <div class="home-guide-stages" class:home-guide-stages--dual={dual}>
        {#if dual}
            <div class="home-guide-stage">
                {#each shots as shot, i (shot + ':L')}
                    <div class="home-guide-shot" class:is-active={i === idxL}
                         style="background-image:url('{shot}')"></div>
                {/each}
            </div>
            <div class="home-guide-stage">
                {#each shots as shot, i (shot + ':R')}
                    <div class="home-guide-shot" class:is-active={i === idxR}
                         style="background-image:url('{shot}')"></div>
                {/each}
            </div>
        {:else}
            <div class="home-guide-stage">
                <div class="home-guide-shot is-active" class:home-guide-shot--fallback={!shots.length}
                     style="background-image:url('{shots[0] ?? header}')"></div>
            </div>
        {/if}
    </div>
</a>
