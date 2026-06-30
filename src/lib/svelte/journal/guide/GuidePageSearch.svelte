<script lang="ts">
    import Fuse from 'fuse.js'
    import { extractPageEntries } from '$lib/guide-blocks-search.js'

    interface Hit { html: string; blockPath?: number[] }

    let { blocks, slug, onScroll }: {
        blocks:   any[]
        slug:     string
        onScroll: (blockPath: number[]) => void
    } = $props()

    let query     = $state('')
    let hits      = $state<Hit[]>([])
    let activeIdx = $state(-1)
    let inputEl   = $state<HTMLInputElement | null>(null)
    let resultsEl = $state<HTMLDivElement | null>(null)

    // Built synchronously from the already-loaded blocks — no loading state needed.
    // $derived is lazy: Fuse is only constructed when the user first types.
    let fuseInst = $derived.by(() => {
        const entries = extractPageEntries(blocks)
        return entries.length > 0
            ? new Fuse(entries, {
                keys: ['text'],
                includeMatches: true,
                includeScore: true,
                threshold: 0.3,
                minMatchCharLength: 3,
                ignoreLocation: true,
              })
            : null
    })

    // Clear search state when the page changes so stale results don't linger.
    $effect(() => {
        const _s = slug
        query = ''
        hits = []
        activeIdx = -1
    })

    // ── Search ────────────────────────────────────────────────────────────────

    function esc(s: string) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    function makeSnippet(text: string, indices: readonly [number, number][]): string {
        if (!indices?.length) return esc(text.slice(0, 180))
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
        // Read fuseInst once; it's a $derived so this triggers lazy construction
        const fuse = fuseInst
        if (!fuse || !q.trim()) { hits = []; return }
        const raw = fuse.search(q.trim(), { limit: 20 })
        const newHits = raw.map(r => ({
            html:      makeSnippet(r.item.text, r.matches?.[0]?.indices ?? []),
            blockPath: r.item.blockPath,
        }))
        hits      = newHits
        activeIdx = newHits.length > 0 ? 0 : -1
    }

    let debounceTimer: ReturnType<typeof setTimeout>
    function onInput() {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => runSearch(query), 150)
    }

    // ── Active result scroll ──────────────────────────────────────────────────

    $effect(() => {
        const idx = activeIdx
        if (idx < 0 || !resultsEl) return
        resultsEl.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
    })

    // ── Keyboard ──────────────────────────────────────────────────────────────

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            if (query) { e.stopPropagation(); query = ''; hits = [] }
            return
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault(); e.stopPropagation()
            activeIdx = Math.min(activeIdx < 0 ? 0 : activeIdx + 1, hits.length - 1)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation()
            activeIdx = Math.max(activeIdx - 1, 0)
        } else if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation()
            const hit = hits[activeIdx]
            if (hit?.blockPath) { inputEl?.blur(); onScroll(hit.blockPath) }
        }
    }

    function select(hit: Hit) {
        if (hit.blockPath) { inputEl?.blur(); onScroll(hit.blockPath) }
    }
</script>

<div class="gps-wrap">
    <div class="gps-bar">
        <svg class="gps-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
            bind:this={inputEl}
            bind:value={query}
            class="gps-input"
            type="search"
            placeholder="Search this page…"
            autocomplete="off"
            spellcheck={false}
            oninput={onInput}
            onkeydown={onKeyDown}
        />
        {#if query && hits.length > 0}
            <span class="gps-count">{hits.length}{hits.length === 20 ? '+' : ''}</span>
        {/if}
        {#if query}
            <!-- svelte-ignore a11y_consider_explicit_label -->
            <button class="gps-clear" onclick={() => { query = ''; hits = []; inputEl?.focus() }} tabindex="-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        {/if}
    </div>

    {#if hits.length > 0}
        <div class="gps-results" bind:this={resultsEl}>
            {#each hits as hit, i}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                <button
                    class="gps-result"
                    class:gps-result--active={i === activeIdx}
                    data-idx={i}
                    onclick={() => select(hit)}
                    onmouseenter={() => activeIdx = i}
                >{@html hit.html}</button>
            {/each}
        </div>
    {:else if query.trim().length >= 2}
        <div class="gps-empty">No results for "{query}"</div>
    {/if}
</div>
