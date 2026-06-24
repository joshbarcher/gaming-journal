<script lang="ts">
    import { onMount } from 'svelte'
    import { goto } from '$app/navigation'
    import type { DiscoverItem } from '../types.js'

    interface Props { onclose: () => void }
    const { onclose }: Props = $props()

    let query      = $state('')
    let results    = $state<DiscoverItem[]>([])
    let loading    = $state(false)
    let activeIdx  = $state(0)
    let inputEl    = $state<HTMLInputElement | null>(null)
    let listEl     = $state<HTMLUListElement | null>(null)

    let _debounce: ReturnType<typeof setTimeout> | null = null

    $effect(() => {
        const q = query.trim()
        if (_debounce) clearTimeout(_debounce)
        if (q.length < 2) { results = []; activeIdx = 0; return }
        _debounce = setTimeout(doSearch, 200)
    })

    $effect(() => {
        // Scroll active result into view when navigating by keyboard
        if (!listEl) return
        const active = listEl.querySelector<HTMLLIElement>('.gs-result--active')
        active?.scrollIntoView({ block: 'nearest' })
    })

    async function doSearch() {
        const q = query.trim()
        if (!q) return
        loading = true
        try {
            const res = await fetch(`/relay/api/discover/search?q=${encodeURIComponent(q)}&limit=8&offset=0`)
            if (!res.ok) return
            const data = await res.json()
            results  = data.results ?? []
            activeIdx = 0
        } catch {
            results = []
        } finally {
            loading = false
        }
    }

    function select(item: DiscoverItem) {
        onclose()
        goto(`/game/${item.appid}`)
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') { onclose(); return }
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            activeIdx = Math.min(activeIdx + 1, results.length - 1)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            activeIdx = Math.max(activeIdx - 1, 0)
        } else if (e.key === 'Enter' && results[activeIdx]) {
            e.preventDefault()
            select(results[activeIdx])
        }
    }

    onMount(() => { inputEl?.focus() })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="gs-scrim" onclick={onclose} role="dialog" aria-modal="true" aria-label="Global game search">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="gs-box" onclick={e => e.stopPropagation()}>
        <div class="gs-input-wrap">
            <svg class="gs-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
                bind:this={inputEl}
                bind:value={query}
                class="gs-input"
                placeholder="Search games…"
                autocomplete="off"
                spellcheck={false}
                onkeydown={onKeyDown}
            />
            {#if loading}
                <span class="gs-spinner"></span>
            {:else if query.length > 0}
                <!-- svelte-ignore a11y_consider_explicit_label -->
                <button class="gs-clear" onclick={() => { query = ''; inputEl?.focus() }} tabindex="-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            {/if}
        </div>

        {#if results.length > 0}
            <ul class="gs-results" bind:this={listEl}>
                {#each results as item, i}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <li
                        class="gs-result"
                        class:gs-result--active={i === activeIdx}
                        onclick={() => select(item)}
                        onmouseenter={() => activeIdx = i}
                    >
                        {#if item.headerImage}
                            <img class="gs-thumb" src={item.headerImage} alt="" loading="lazy" />
                        {:else}
                            <div class="gs-thumb gs-thumb--empty"></div>
                        {/if}
                        <span class="gs-result-name">{item.name}</span>
                        <svg class="gs-result-arrow" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                        </svg>
                    </li>
                {/each}
            </ul>
        {:else if query.trim().length >= 2 && !loading}
            <div class="gs-empty">No games found</div>
        {/if}

        <div class="gs-hint">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
        </div>
    </div>
</div>
