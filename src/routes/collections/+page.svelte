<script lang="ts">
    import { page } from '$app/state'
    import { goto } from '$app/navigation'
    import { store } from '$lib/sidebar.svelte.js'
    import InProgress from '$lib/svelte/in-progress/InProgress.svelte'
    import Backlog    from '$lib/svelte/backlog/Backlog.svelte'
    import HallOfFame from '$lib/svelte/hall-of-fame/HallOfFame.svelte'
    import Favorites  from '$lib/svelte/favorites/Favorites.svelte'
    import Abandoned  from '$lib/svelte/abandoned/Abandoned.svelte'

    // The five status collections, formerly five separate nav pages, unified here as tabs. Each tab
    // renders the exact same component the standalone page used (in `embedded` mode: its own tall
    // header is dropped in favour of the shared tab strip + a compact meta line). `accent` is each
    // collection's signature colour, mirrored from its page CSS so the active tab wears its identity.
    const TABS = [
        { id: 'in-progress', label: 'In Progress', component: InProgress, countKey: 'inProgress', accent: '#e0a052' },
        { id: 'backlog',     label: 'Backlog',     component: Backlog,    countKey: 'backlog',    accent: '#7c6fcd' },
        { id: 'completed',   label: 'Completed',   component: HallOfFame, countKey: 'completed',  accent: '#c9a84c' },
        { id: 'favorites',   label: 'Favorites',   component: Favorites,  countKey: 'favorites',  accent: '#c45c7a' },
        { id: 'abandoned',   label: 'Abandoned',   component: Abandoned,  countKey: 'dropped',    accent: '#c87941' },
    ] as const

    const DEFAULT_TAB = 'in-progress'

    // Active tab is driven by the ?tab= query so it's deep-linkable and survives back/forward. An
    // unknown/absent value falls back to the default rather than rendering nothing.
    function resolveTab(): string {
        const t = page.url.searchParams.get('tab')
        return TABS.some(x => x.id === t) ? t! : DEFAULT_TAB
    }
    let active = $derived(resolveTab())
    let activeAccent = $derived(TABS.find(t => t.id === active)?.accent ?? '#c9a84c')

    // Keep-alive: each collection component fetches on mount, so we render a tab once it's first
    // visited and thereafter only toggle its visibility. Re-clicking a visited tab is instant and
    // never refetches. Seed with the INITIAL active tab (not the default) so a deep link to e.g.
    // ?tab=completed doesn't also mount + fetch In Progress behind the scenes.
    let visited = $state<Set<string>>(new Set([resolveTab()]))
    $effect(() => {
        if (!visited.has(active)) visited = new Set(visited).add(active)
    })

    function switchTab(id: string) {
        if (id === active) return
        // replaceState so cycling tabs doesn't flood history; deep links still work.
        goto(`?tab=${id}`, { replaceState: true, keepFocus: true, noScroll: true })
    }
</script>

<svelte:head><title>Collections</title></svelte:head>

<div class="coll-tabs-bar" style="--coll-acc:{activeAccent}">
    <p class="coll-eyebrow">Collections</p>
    <div class="coll-tabs" role="tablist" aria-label="Collections">
        {#each TABS as t (t.id)}
            {@const count = store.counts[t.countKey] ?? 0}
            <button
                class="coll-tab"
                class:coll-tab--active={active === t.id}
                style="--coll-acc:{t.accent}"
                role="tab"
                aria-selected={active === t.id}
                onclick={() => switchTab(t.id)}
            >
                {t.label}{#if count > 0}<span class="coll-tab-count">{count}</span>{/if}
            </button>
        {/each}
    </div>
</div>

{#each TABS as t (t.id)}
    {#if visited.has(t.id)}
        {@const Comp = t.component}
        <div class="coll-panel" class:coll-panel--hidden={active !== t.id}>
            <Comp embedded />
        </div>
    {/if}
{/each}

<style>
    .coll-panel--hidden { display: none; }
</style>
