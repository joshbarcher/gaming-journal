<script lang="ts">
    import { onMount, untrack } from 'svelte'
    import type Fuse from 'fuse.js'
    import type { FtEntry } from '$lib/guide-cache.js'

    interface HitSnippet { html: string; blockPath?: number[]; flatIdx: number }
    interface HitGroup   { slug: string; label: string; pageIdx: number; snippets: HitSnippet[] }

    let { fuse, onclose, onNav }: {
        fuse:    Fuse<FtEntry> | null
        onclose: () => void
        onNav:   (slug: string, blockPath?: number[]) => void
    } = $props()

    let query     = $state('')
    let hits      = $state<HitGroup[]>([])
    let activeIdx = $state(-1)
    let inputEl   = $state<HTMLInputElement | null>(null)
    let resultsEl = $state<HTMLDivElement | null>(null)

    let searchReady  = $derived(fuse !== null)
    let indexLoading = $derived(fuse === null)
    let flatTotal    = $derived(hits.reduce((sum, g) => sum + 1 + g.snippets.length, 0))

    // ── Search ────────────────────────────────────────────────────────────────

    function esc(s: string) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

    function runSearch(q: string) {
        if (!fuse || !q.trim()) { hits = []; return }
        const qLower = q.trim().toLowerCase()
        const raw = fuse.search(q.trim(), { limit: 60 })
        const groups = new Map<string, { slug: string; label: string; snippets: { html: string; blockPath?: number[] }[] }>()
        const exactSlugs = new Set<string>()
        for (const r of raw) {
            const { slug, label, text } = r.item
            const indices = r.matches?.[0]?.indices ?? []
            if (!groups.has(slug)) {
                if (groups.size >= 6) continue
                groups.set(slug, { slug, label, snippets: [] })
            }
            const g = groups.get(slug)!
            if (g.snippets.length < 3) {
                g.snippets.push({ html: makeSnippet(text, indices as [number, number][]), blockPath: r.item.blockPath })
            }
            if (text.toLowerCase().includes(qLower)) exactSlugs.add(slug)
        }
        const sorted = [...groups.values()].sort((a, b) => +exactSlugs.has(b.slug) - +exactSlugs.has(a.slug))
        let fi = 0
        const newHits = sorted.map(g => ({
            slug: g.slug,
            label: g.label,
            pageIdx: fi++,
            snippets: g.snippets.map(s => ({ ...s, flatIdx: fi++ })),
        }))
        hits      = newHits
        activeIdx = newHits.length > 0 ? 0 : -1
    }

    // If the index arrives after the user has already typed, run the search now.
    $effect(() => {
        const f = fuse
        if (!f) return
        untrack(() => { if (query) runSearch(query) })
    })

    let debounceTimer: ReturnType<typeof setTimeout>
    function onInput() {
        clearTimeout(debounceTimer)
        if (!searchReady) return
        debounceTimer = setTimeout(() => runSearch(query), 180)
    }

    // ── Active result scroll ──────────────────────────────────────────────────

    $effect(() => {
        const idx = activeIdx
        if (idx < 0 || !resultsEl) return
        resultsEl.querySelector<HTMLElement>(`[data-fi="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
    })

    // ── Keyboard ──────────────────────────────────────────────────────────────

    function selectByIdx(fi: number) {
        for (const group of hits) {
            if (group.pageIdx === fi) { select(group.slug); return }
            for (const s of group.snippets) {
                if (s.flatIdx === fi) { select(group.slug, s.blockPath); return }
            }
        }
    }

    function select(slug: string, blockPath?: number[]) {
        onclose()
        onNav(slug, blockPath)
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') { onclose(); return }
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            e.stopPropagation()
            activeIdx = Math.min(activeIdx < 0 ? 0 : activeIdx + 1, flatTotal - 1)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            activeIdx = Math.max(activeIdx - 1, 0)
        } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault()
            e.stopPropagation()
            selectByIdx(activeIdx)
        }
    }

    onMount(() => {
        inputEl?.focus()
    })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="gis-scrim" onclick={onclose} role="dialog" aria-modal="true" aria-label="Search in guide">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="gis-box" onclick={e => e.stopPropagation()}>

        <div class="gis-input-wrap">
            <svg class="gis-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
                bind:this={inputEl}
                bind:value={query}
                class="gis-input"
                placeholder="Search in guide…"
                autocomplete="off"
                spellcheck={false}
                oninput={onInput}
                onkeydown={onKeyDown}
            />
            {#if indexLoading}
                <span class="gis-spinner"></span>
            {:else if query.length > 0}
                <!-- svelte-ignore a11y_consider_explicit_label -->
                <button class="gis-clear" onclick={() => { query = ''; hits = []; activeIdx = -1; inputEl?.focus() }} tabindex="-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            {/if}
        </div>

        {#if hits.length > 0}
            <div class="gis-results" bind:this={resultsEl}>
                {#each hits as group}
                    <div class="gis-group">
                        <button
                            class="gis-page-btn"
                            class:gis-item--active={group.pageIdx === activeIdx}
                            data-fi={group.pageIdx}
                            onclick={() => select(group.slug)}
                            onmouseenter={() => activeIdx = group.pageIdx}
                        >{group.label}</button>
                        {#each group.snippets as snippet}
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                            <button
                                class="gis-snippet"
                                class:gis-item--active={snippet.flatIdx === activeIdx}
                                data-fi={snippet.flatIdx}
                                onclick={() => select(group.slug, snippet.blockPath)}
                                onmouseenter={() => activeIdx = snippet.flatIdx}
                            >{@html snippet.html}</button>
                        {/each}
                    </div>
                {/each}
            </div>
        {:else if query.trim().length >= 2 && searchReady}
            <div class="gis-empty">No results for "{query}"</div>
        {:else if !searchReady}
            <div class="gis-empty gis-empty--loading">Loading index…</div>
        {/if}

        <div class="gis-hint">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
            <span class="gis-hint-label">Search in guide</span>
        </div>
    </div>
</div>
