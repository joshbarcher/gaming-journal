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
    // renders the exact same component the standalone page used, so the per-collection view is
    // unchanged — only the navigation is consolidated. Order matches the old sidebar order.
    const TABS = [
        { id: 'in-progress', label: 'In Progress', component: InProgress, countKey: 'inProgress' },
        { id: 'backlog',     label: 'Backlog',     component: Backlog,    countKey: 'backlog'    },
        { id: 'completed',   label: 'Completed',   component: HallOfFame, countKey: 'completed'  },
        { id: 'favorites',   label: 'Favorites',   component: Favorites,  countKey: 'favorites'  },
        { id: 'abandoned',   label: 'Abandoned',   component: Abandoned,  countKey: 'dropped'    },
    ] as const

    const DEFAULT_TAB = 'in-progress'

    // Active tab is driven by the ?tab= query so it's deep-linkable and survives back/forward. An
    // unknown/absent value falls back to the default rather than rendering nothing.
    let active = $derived.by(() => {
        const t = page.url.searchParams.get('tab')
        return TABS.some(x => x.id === t) ? t! : DEFAULT_TAB
    })

    // Keep-alive: each collection component fetches on mount, so we render a tab once it's first
    // visited and thereafter only toggle its visibility. Re-clicking a visited tab is instant and
    // never refetches (no full-refresh churn).
    let visited = $state<Set<string>>(new Set([DEFAULT_TAB]))
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

<div class="collections-tabs-bar">
    <div class="collections-tabs" role="tablist" aria-label="Collections">
        {#each TABS as t (t.id)}
            {@const count = store.counts[t.countKey] ?? 0}
            <button
                class="collections-tab"
                class:collections-tab--active={active === t.id}
                role="tab"
                aria-selected={active === t.id}
                onclick={() => switchTab(t.id)}
            >
                {t.label}
                {#if count > 0}<span class="collections-tab-count">{count}</span>{/if}
            </button>
        {/each}
    </div>
</div>

{#each TABS as t (t.id)}
    {#if visited.has(t.id)}
        {@const Comp = t.component}
        <div class="collections-panel" class:collections-panel--hidden={active !== t.id}>
            <Comp />
        </div>
    {/if}
{/each}

<style>
    .collections-tabs-bar {
        display: flex;
        align-items: center;
        margin-bottom: 16px;
    }
    .collections-tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    .collections-tab {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 8px 14px;
        background: var(--clr-bg-raised);
        border: 1px solid var(--clr-border);
        border-radius: var(--radius);
        color: var(--clr-text-muted);
        font-size: 13px;
        font-family: var(--font-ui);
        font-weight: 600;
        cursor: pointer;
        transition: border-color var(--transition), color var(--transition), background var(--transition);
    }
    .collections-tab:hover:not(.collections-tab--active) {
        border-color: var(--clr-border-hi);
        color: var(--clr-text);
    }
    .collections-tab--active {
        border-color: var(--clr-accent);
        background: var(--clr-accent-bg);
        color: var(--clr-accent);
    }
    .collections-tab-count {
        min-width: 18px;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--clr-bg);
        color: var(--clr-text-muted);
        font-size: 11px;
        font-weight: 700;
        text-align: center;
    }
    .collections-tab--active .collections-tab-count {
        background: var(--clr-accent);
        color: var(--clr-bg);
    }
    .collections-panel--hidden {
        display: none;
    }

    @media (max-width: 640px) {
        .collections-tabs-bar {
            padding-bottom: 12px;
            border-bottom: 1px solid var(--clr-border);
        }
        .collections-tabs {
            gap: 4px;
            width: 100%;
        }
        .collections-tab {
            padding: 7px 11px;
            font-size: 12px;
        }
    }
</style>
