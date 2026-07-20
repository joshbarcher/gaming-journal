<script lang="ts">
    import { onMount } from 'svelte'
    import { api } from '../../js/api.js'
    import { showError } from '../../js/dialog.js'
    import { navigate } from '../../js/router.js'
    import type { Franchise, SteamGame } from '../../types.js'
    import Icon from '../Icon.svelte'

    let franchises       = $state<Franchise[]>([])
    let flagsRes         = $state<Record<string, any>>({})
    let ownedMap         = $state<Map<number, SteamGame>>(new Map())
    let loading          = $state(true)
    let error            = $state<string | null>(null)
    let showCreateDialog = $state(false)
    let createName       = $state('')

    function fmtHours(mins: number) {
        if (!mins) return null
        const h = mins / 60
        if (h < 1)  return `${Math.round(mins)}m`
        if (h < 10) return `${h.toFixed(1)}h`
        return `${Math.round(h)}h`
    }

    function franchiseStats(franchise: Franchise) {
        const entries = franchise.entries ?? []
        let completed = 0, totalHours = 0
        for (const e of entries) {
            const flags   = flagsRes[e.appid]
            const playtime = ownedMap.get(e.appid)?.playtime_forever ?? 0
            if (flags?.completed) completed++
            totalHours += playtime
        }
        const pct = entries.length ? Math.round((completed / entries.length) * 100) : 0
        return { entries, completed, pct, hrs: fmtHours(totalHours) }
    }

    // Spread N indices evenly across array of given length
    function spreadIndices(len: number, n: number) {
        if (len === 0) return []
        if (len <= n)  return Array.from({ length: len }, (_, i) => i)
        return Array.from({ length: n }, (_, i) => Math.round(i * (len - 1) / (n - 1)))
    }

    // Svelte action: progressively load mosaic images with fallback
    function mosaicCell(cellEl: HTMLElement, candidates: number[]) {
        let idx = 0
        function tryNext() {
            while (idx < candidates.length) {
                const appid = candidates[idx++]
                const img   = new Image()
                img.className = 'frc-card-mosaic-img'
                img.alt       = ''
                img.onerror   = tryNext
                img.onload    = () => { cellEl.innerHTML = ''; cellEl.appendChild(img) }
                img.src       = `/relay/images/steam/games/${appid}/header.jpg`
                return
            }
            cellEl.innerHTML = '<div class="frc-card-mosaic-placeholder"></div>'
        }
        tryNext()
        return { destroy() {} }
    }

    function mosaicSlots(entries: { appid: number }[]) {
        const SLOTS      = 4
        const spreadIdx  = spreadIndices(entries.length, SLOTS)
        const used       = new Set(spreadIdx.map(i => entries[i]?.appid).filter(Boolean))
        const fallbacks  = entries.map(e => e.appid).filter(id => !used.has(id))
        return Array.from({ length: SLOTS }, (_, slot) => {
            const primary = entries[spreadIdx[slot]]?.appid
            return primary ? [primary, ...fallbacks] : [...fallbacks]
        })
    }

    function autoFocus(el: HTMLElement) {
        requestAnimationFrame(() => el.focus())
        return { destroy() {} }
    }

    async function submitCreate() {
        const name = createName.trim()
        if (!name) return
        try {
            const f = await api.franchises.create({ name })
            franchises = [...franchises, f]
            showCreateDialog = false
            createName       = ''
            navigate(`franchise/${f.id}`)
        } catch (err) {
            showError(`Failed to create franchise: ${(err as Error).message}`)
        }
    }

    onMount(async () => {
        try {
            const [fList, flagsJson, gamesJson] = await Promise.all([
                api.franchises.list(),
                fetch('/api/flags').then(r => r.json()),
                fetch('/relay/api/steam/games').then(r => r.json()),
            ])
            const games = Array.isArray(gamesJson) ? gamesJson
                : Array.isArray(gamesJson.games)   ? gamesJson.games
                : []
            franchises = fList
            flagsRes   = flagsJson
            ownedMap   = new Map(games.map((g: SteamGame) => [g.appid, g]))
        } catch (err) {
            error = (err as Error).message
        }
        loading = false
    })
</script>

{#if loading}
    <div class="page-loading">Loading franchises…</div>
{:else if error}
    <div class="page-error">Failed to load: {error}</div>
{:else}
    <div class="frc-list-header">
        <div class="frc-list-header-body">
            <p class="frc-list-eyebrow">Collection</p>
            <h1 class="frc-list-title">Franchises</h1>
            <p class="frc-list-subtitle">{franchises.length} franchise{franchises.length !== 1 ? 's' : ''}</p>
        </div>
        <button class="frc-new-btn" onclick={() => { showCreateDialog = true; createName = '' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Franchise
        </button>
    </div>

    {#if franchises.length === 0}
        <div class="frc-grid">
            <div class="frc-empty">
                <div class="frc-empty-icon"><Icon name="gamepad-2" tone="sky" size={42} /></div>
                <p class="frc-empty-text">No franchises yet</p>
                <p class="frc-empty-sub">Create your first franchise to start tracking a game series.</p>
            </div>
        </div>
    {:else}
        <div class="frc-grid">
            {#each franchises as franchise (franchise.id)}
                {@const { entries, completed, pct, hrs } = franchiseStats(franchise)}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="frc-card" onclick={() => navigate(`franchise/${franchise.id}`)}>
                    <div class="frc-card-mosaic">
                        {#if entries.length > 0}
                            <span class="frc-card-mosaic-count">{entries.length} game{entries.length !== 1 ? 's' : ''}</span>
                        {/if}
                        {#each mosaicSlots(entries) as candidates}
                            <div class="frc-card-mosaic-cell" use:mosaicCell={candidates}></div>
                        {/each}
                    </div>
                    <div class="frc-card-body">
                        <div class="frc-card-name">{franchise.name}</div>
                        <div class="frc-card-stats">
                            <span class="frc-card-stat">
                                <span class="frc-card-stat-value">{completed}</span>/<span>{entries.length}</span> completed
                            </span>
                            {#if hrs}
                                <span class="frc-card-stat"><span class="frc-card-stat-value">{hrs}</span> played</span>
                            {/if}
                        </div>
                        <div class="frc-card-bar-track">
                            <div class="frc-card-bar-fill" style="width:{pct}%"></div>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
{/if}

{#if showCreateDialog}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="dialog-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) showCreateDialog = false }}>
        <div class="dialog-box" style="max-width:380px">
            <h2 class="dialog-title">New Franchise</h2>
            <p class="dialog-body" style="margin-bottom:12px">Enter a name for your new franchise series:</p>
            <input class="dialog-input" type="text" placeholder="e.g. Monster Hunter"
                   autocomplete="off" maxlength="100"
                   bind:value={createName}
                   use:autoFocus
                   onkeydown={(e) => {
                       if (e.key === 'Enter') { e.preventDefault(); submitCreate() }
                       if (e.key === 'Escape') showCreateDialog = false
                   }}>
            <div class="dialog-actions">
                <button class="dialog-btn dialog-btn--cancel" onclick={() => showCreateDialog = false}>Cancel</button>
                <button class="dialog-btn dialog-btn--confirm" onclick={submitCreate}>Create</button>
            </div>
        </div>
    </div>
{/if}
