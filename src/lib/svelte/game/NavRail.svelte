<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { getScrollInstance } from '$lib/actions/scrollbar.js'

    // Sections are watched; rail rebuilds whenever the DOM changes (bg sections loading in)
    let { container } = $props()

    const NAV_ICONS = {
        home:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
        video:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
        bookOpen:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 0 3-3h7z"/></svg>`,
        clock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        barChart:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
        image:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
        newspaper: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M16 8H8"/><path d="M16 12H8"/><path d="M10 16H8"/></svg>`,
        star:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        thumbsUp:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`,
        msgCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
        tag:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
        monitor:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
        award:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>`,
    }

    const ALL_ITEMS = [
        { id: 'game-sec-hero',              label: 'Top',               icon: NAV_ICONS.home      },
        { id: 'game-sec-trailers',          label: 'Trailers',          icon: NAV_ICONS.video     },
        { id: 'game-sec-about',             label: 'About',             icon: NAV_ICONS.bookOpen  },
        { id: 'game-sec-hltb',              label: 'How Long To Beat',  icon: NAV_ICONS.clock     },
        { id: 'game-sec-player-count',      label: 'Player Count',      icon: NAV_ICONS.barChart  },
        { id: 'game-sec-screenshots',       label: 'Screenshots',       icon: NAV_ICONS.image     },
        { id: 'game-sec-news',              label: 'News',              icon: NAV_ICONS.newspaper },
        { id: 'game-sec-local-review',      label: 'Local Review',      icon: NAV_ICONS.star      },
        { id: 'game-sec-steam-review',      label: 'Steam Review',      icon: NAV_ICONS.thumbsUp  },
        { id: 'game-sec-community-reviews', label: 'Community Reviews', icon: NAV_ICONS.msgCircle },
        { id: 'game-sec-prices',            label: 'Prices',            icon: NAV_ICONS.tag       },
        { id: 'game-sec-protondb',          label: 'Linux Compat.',     icon: NAV_ICONS.award     },
        { id: 'game-sec-pcgw',              label: 'PCGamingWiki',      icon: NAV_ICONS.monitor   },
    ]

    let visible  = $state<typeof ALL_ITEMS>([] as typeof ALL_ITEMS)
    let activeId = $state(ALL_ITEMS[0].id)
    let railEl   = $state<HTMLElement | null>(null)

    function rebuild() {
        visible = ALL_ITEMS.filter(item => document.getElementById(item.id))
    }

    function updateActive() {
        if (!visible.length) return
        let next = visible[0].id
        for (const item of visible) {
            const el = document.getElementById(item.id)
            if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.4) next = item.id
        }
        activeId = next
    }

    function updatePosition() {
        if (!railEl || !container) return
        const flagsInner = container.querySelector('.game-flags-inner')
        const hero       = document.getElementById('game-sec-hero')
        if (!flagsInner && !hero) return
        const top = flagsInner
            ? flagsInner.getBoundingClientRect().top + 6
            : hero!.getBoundingClientRect().bottom
        railEl.style.top = Math.max(top, 20) + 'px'
    }

    function onScroll() { updatePosition(); updateActive() }

    function scrollTo(id: string) {
        const target = document.getElementById(id)
        if (!target || !scrollEl) return
        const offset = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top
        scrollEl.scrollBy({ top: offset, behavior: 'smooth' })
    }

    let scrollEl: HTMLElement | null = null
    let mo: MutationObserver | undefined

    onMount(() => {
        // Portal: move rail to body so it floats outside the game container
        if (railEl) document.body.appendChild(railEl)

        rebuild()
        updatePosition()
        updateActive()

        const mainContent = document.getElementById('main-content')
        scrollEl = getScrollInstance()?.elements().viewport as HTMLElement ?? mainContent
        scrollEl?.addEventListener('scroll', onScroll, { passive: true })

        mo = new MutationObserver(() => { rebuild(); updatePosition(); updateActive() })
        if (container) mo.observe(container, { childList: true, subtree: true })
    })

    onDestroy(() => {
        scrollEl?.removeEventListener('scroll', onScroll)
        mo?.disconnect()
        railEl?.remove()
    })
</script>

<!-- Rendered here first, then moved to body in onMount -->
<nav class="game-nav-rail" bind:this={railEl} aria-label="Page sections">
    {#each visible as item}
        <button
            class="gnr-btn"
            class:gnr-btn--active={activeId === item.id}
            title={item.label}
            onclick={() => scrollTo(item.id)}
        >
            {@html item.icon}
        </button>
    {/each}
</nav>
