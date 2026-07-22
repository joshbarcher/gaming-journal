<script lang="ts">
    import { onMount } from 'svelte'
    import { loadGameFilter } from '../../js/views/game-filter.js'
    import type { SteamGame } from '../../types.js'

    let { embedded = false }: { embedded?: boolean } = $props()

    let games           = $state<SteamGame[]>([])
    let loading         = $state(true)
    let error           = $state<string | null>(null)
    let draggedAppid    = $state<number | null>(null)
    let dropTargetAppid = $state<number | null>(null)
    let dropSide        = $state<string | null>(null)

    let queueGames = $derived(games.slice(0, 3))
    let restGames  = $derived(games.slice(3))
    let totalMins  = $derived(games.reduce((s, g) => s + (g.playtime ?? 0), 0))
    let subtitle   = $derived(
        totalMins > 0
            ? `${fmtHours(totalMins)} invested across ${games.length} paused game${games.length !== 1 ? 's' : ''}`
            : `${games.length} game${games.length !== 1 ? 's' : ''} paused`
    )

    function fmtHours(mins: number | null | undefined) {
        if (!mins) return null
        const h = mins / 60
        if (h < 1)  return `${Math.round(mins)}m`
        if (h < 10) return `${h.toFixed(1)}h`
        return `${Math.round(h)}h`
    }

    function progressData(game: SteamGame) {
        const hltb    = game.hltb
        const playedH = (game.playtime ?? 0) / 60
        const main    = hltb?.gameplayMain          ?? null
        const extra   = hltb?.gameplayMainExtra     ?? null
        const comp    = hltb?.gameplayCompletionist ?? null

        if (!main && !extra && !comp) return null

        const ceiling = (comp ?? extra ?? main)!
        const fillPct = Math.min((playedH / ceiling) * 100, 100)

        const ticks = []
        if (main  && main  < ceiling) ticks.push({ pct: (main  / ceiling) * 100, label: 'Main'   })
        if (extra && extra < ceiling) ticks.push({ pct: (extra / ceiling) * 100, label: 'Extras' })

        let label = ''
        const pct = (n: number) => Math.round((playedH / n) * 100)
        if      (main  && playedH < main)  label = `${pct(main)}% of Main Story`
        else if (extra && playedH < extra) label = `Main done · ${pct(extra)}% of Main+Extras`
        else if (comp  && playedH < comp)  label = `Extras done · ${pct(comp)}% completionist`
        else                               label = `Past all estimates`

        return { fillPct: fillPct.toFixed(1), ticks, label }
    }

    async function loadOrder() {
        try {
            const res = await fetch('/api/order/in-progress')
            if (!res.ok) return []
            const data = await res.json()
            return Array.isArray(data) ? data : []
        } catch { return [] }
    }

    function saveOrder(appids: number[]) {
        fetch('/api/order/in-progress', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(appids),
        }).catch(() => {})
    }

    // ── Drag handlers ─────────────────────────────────────────────────────────

    function onDragStart(appid: number) {
        requestAnimationFrame(() => { draggedAppid = appid })
    }

    function onDragEnd() {
        draggedAppid    = null
        dropTargetAppid = null
        dropSide        = null
    }

    function onDragOver(e: DragEvent & { currentTarget: HTMLElement }, appid: number) {
        e.preventDefault()
        if (draggedAppid === null || draggedAppid === appid) return
        const rect      = e.currentTarget.getBoundingClientRect()
        dropTargetAppid = appid
        dropSide        = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    }

    function onDragLeave(e: DragEvent & { currentTarget: HTMLElement }) {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            dropTargetAppid = null
            dropSide        = null
        }
    }

    function onDrop(e: DragEvent, targetAppid: number) {
        e.preventDefault()
        if (draggedAppid === null || draggedAppid === targetAppid) return
        const isBefore  = dropSide === 'before'
        dropTargetAppid = null
        dropSide        = null

        const newGames  = [...games]
        const fromIdx   = newGames.findIndex(g => g.appid === draggedAppid)
        if (fromIdx === -1) return
        const [dragged] = newGames.splice(fromIdx, 1)
        const toIdx     = newGames.findIndex(g => g.appid === targetAppid)
        if (toIdx === -1) newGames.push(dragged)
        else newGames.splice(isBefore ? toIdx : toIdx + 1, 0, dragged)
        games = newGames
        saveOrder(games.map(g => g.appid))
    }

    onMount(async () => {
        try {
            const [flagsRes, gamesRes, order, shouldShow] = await Promise.all([
                fetch('/api/flags'),
                fetch('/relay/api/steam/games'),
                loadOrder(),
                loadGameFilter(),
            ])
            if (!flagsRes.ok) throw new Error(`Flags HTTP ${flagsRes.status}`)
            if (!gamesRes.ok) throw new Error(`Games HTTP ${gamesRes.status}`)

            const flags    = await flagsRes.json()
            const gamesRaw = await gamesRes.json()
            const owned    = Array.isArray(gamesRaw) ? gamesRaw : (gamesRaw.games ?? [])
            const ownedMap = new Map<number, SteamGame>(owned.map((g: SteamGame) => [g.appid, g]))
            const ids      = Object.entries(flags as Record<string, any>).filter(([, f]) => f.inProgress).map(([id]) => Number(id)).filter(appid => shouldShow(appid))

            if (!ids.length) { loading = false; return }

            // Render immediately with available data
            const base    = ids.map(appid => {
                const o = ownedMap.get(appid)
                return { appid, name: o?.name ?? `App ${appid}`, playtime: o?.playtime_forever ?? 0 } as SteamGame
            })
            const sorted  = base.sort((a, b) => (b.playtime ?? 0) - (a.playtime ?? 0))
            const gameMap = new Map(sorted.map(g => [g.appid, g]))
            const ordered: SteamGame[] = []
            const seen    = new Set<number>()
            for (const appid of order) {
                if (gameMap.has(appid)) { ordered.push(gameMap.get(appid)!); seen.add(appid) }
            }
            for (const g of sorted) { if (!seen.has(g.appid)) ordered.push(g) }
            games   = ordered
            loading = false

            // Background: fetch HLTB and missing names per game
            for (const appid of ids) {
                fetch(`/relay/api/hltb/${appid}`)
                    .then(r => r.ok ? r.json() : null)
                    .then(hltb => {
                        if (!hltb) return
                        const idx = games.findIndex(g => g.appid === appid)
                        if (idx !== -1) games[idx] = { ...games[idx], hltb }
                    })
                    .catch(() => {})

                if (!ownedMap.has(appid)) {
                    fetch(`/relay/api/games/${appid}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(d => {
                            if (!d?.name) return
                            const idx = games.findIndex(g => g.appid === appid)
                            if (idx !== -1) games[idx] = { ...games[idx], name: d.name }
                        })
                        .catch(() => {})
                }
            }
        } catch (err) {
            error   = (err as Error).message
            loading = false
        }
    })
</script>

{#if loading}
    <p class="page-loading">Loading…</p>
{:else if error}
    <p class="page-error">Failed to load: {error}</p>
{:else}
    {#if !embedded}
        <div class="inprogress-header">
            <div class="inprogress-header-body">
                <p class="inprogress-eyebrow">Collection</p>
                <h1 class="inprogress-title">In Progress</h1>
                {#if games.length}<p class="inprogress-subtitle">{subtitle}</p>{/if}
            </div>
        </div>
    {/if}
    {#if !games.length}
        <p class="page-empty" style="padding:40px">
            No games on hold. Open any game page and toggle the
            <strong>In Progress</strong> flag to track paused playthroughs here.
        </p>
    {:else}
        {#if embedded}<p class="coll-panel-meta">{subtitle}</p>{/if}
        <div class="inprogress-queue">
            <div class="inprogress-queue-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span class="inprogress-queue-label">Up Next</span>
                <span class="inprogress-queue-hint">Drag to reorder</span>
            </div>
            <div class="inprogress-queue-row">
                {#each queueGames as g, i (g.appid)}
                    {@const prog   = progressData(g)}
                    {@const playedH = fmtHours(g.playtime)}
                    <a class="inprogress-card inprogress-card--up-next"
                       class:inprogress-card--dragging={g.appid === draggedAppid}
                       class:inprogress-card--drop-before={dropTargetAppid === g.appid && dropSide === 'before'}
                       class:inprogress-card--drop-after={dropTargetAppid === g.appid && dropSide === 'after'}
                       href="/game/{g.appid}" data-game-card data-appid={g.appid} data-game-name={g.name} draggable="true"
                       ondragstart={() => onDragStart(g.appid)}
                       ondragend={onDragEnd}
                       ondragover={(e) => onDragOver(e, g.appid)}
                       ondragleave={onDragLeave}
                       ondrop={(e) => onDrop(e, g.appid)}>
                        <div class="inprogress-card-img-wrap">
                            <img class="inprogress-card-img"
                                 src="/relay/images/steam/games/{g.appid}/header.jpg"
                                 alt="" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                            <div class="inprogress-card-overlay"></div>
                            <span class="inprogress-card-num">{i + 1}</span>
                            {#if playedH}<span class="inprogress-card-time" title="Time played so far">{playedH}</span>{/if}
                        </div>
                        <div class="inprogress-card-body">
                            <span class="inprogress-card-name">{g.name}</span>
                            {#if prog?.label}<span class="inprogress-card-progress-label">{prog.label}</span>{/if}
                        </div>
                        {#if prog}
                            <div class="inprogress-bar-wrap">
                                <div class="inprogress-bar-track">
                                    <div class="inprogress-bar-fill" style="width:{prog.fillPct}%"></div>
                                    {#each prog.ticks as tick}
                                        <span class="inprogress-bar-tick" style="left:{tick.pct.toFixed(1)}%" title="{tick.label}"></span>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </a>
                {/each}
            </div>
        </div>
        {#if restGames.length}
            <div class="inprogress-rest-sep">
                <span class="inprogress-rest-sep-label">Queue &middot; {restGames.length} more</span>
            </div>
            <div class="inprogress-grid">
                {#each restGames as g (g.appid)}
                    {@const prog    = progressData(g)}
                    {@const playedH = fmtHours(g.playtime)}
                    <a class="inprogress-card"
                       class:inprogress-card--dragging={g.appid === draggedAppid}
                       class:inprogress-card--drop-before={dropTargetAppid === g.appid && dropSide === 'before'}
                       class:inprogress-card--drop-after={dropTargetAppid === g.appid && dropSide === 'after'}
                       href="/game/{g.appid}" data-game-card data-appid={g.appid} data-game-name={g.name} draggable="true"
                       ondragstart={() => onDragStart(g.appid)}
                       ondragend={onDragEnd}
                       ondragover={(e) => onDragOver(e, g.appid)}
                       ondragleave={onDragLeave}
                       ondrop={(e) => onDrop(e, g.appid)}>
                        <div class="inprogress-card-img-wrap">
                            <img class="inprogress-card-img"
                                 src="/relay/images/steam/games/{g.appid}/header.jpg"
                                 alt="" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                            <div class="inprogress-card-overlay"></div>
                            {#if playedH}<span class="inprogress-card-time" title="Time played so far">{playedH}</span>{/if}
                        </div>
                        <div class="inprogress-card-body">
                            <span class="inprogress-card-name">{g.name}</span>
                            {#if prog?.label}<span class="inprogress-card-progress-label">{prog.label}</span>{/if}
                        </div>
                        {#if prog}
                            <div class="inprogress-bar-wrap">
                                <div class="inprogress-bar-track">
                                    <div class="inprogress-bar-fill" style="width:{prog.fillPct}%"></div>
                                    {#each prog.ticks as tick}
                                        <span class="inprogress-bar-tick" style="left:{tick.pct.toFixed(1)}%" title="{tick.label}"></span>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </a>
                {/each}
            </div>
        {/if}
    {/if}
{/if}
