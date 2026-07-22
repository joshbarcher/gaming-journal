<script lang="ts">
    import { onMount } from 'svelte'
    import { loadGameFilter } from '../../js/views/game-filter.js'
    import { store } from '$lib/sidebar.svelte.js'
    import type { SteamGame } from '../../types.js'

    let games           = $state<SteamGame[]>([])
    let loading         = $state(true)
    let error           = $state<string | null>(null)
    let draggedAppid    = $state<number | null>(null)
    let dropTargetAppid = $state<number | null>(null)
    let dropSide        = $state<string | null>(null)

    let queueGames = $derived(games.slice(0, 3))
    let restGames  = $derived(games.slice(3))
    let subtitle   = $derived(
        games.length
            ? `${games.length} game${games.length !== 1 ? 's' : ''} queued up to play`
            : 'Your play list is empty'
    )

    // The Current card reflects what you're actually playing — the live now-playing session, falling
    // back to your last session. It's deliberately separate from the play list (a game can be Current
    // whether or not it's queued). Data already flows into the shared sidebar store; no extra fetch.
    let current       = $derived(store.nowPlaying ?? store.lastPlayed ?? null)
    let currentIsLive = $derived(!!store.nowPlaying)
    let currentElapsed = $derived(store.nowPlaying?.elapsed ?? null)

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
        else if (playedH > 0)              label = `Past all estimates`
        else if (main)                     label = `~${fmtHours(main * 60)} to beat`

        return { fillPct: fillPct.toFixed(1), ticks, label }
    }

    async function loadOrder() {
        try {
            const res = await fetch('/api/order/playlist')
            if (!res.ok) return []
            const data = await res.json()
            return Array.isArray(data) ? data : []
        } catch { return [] }
    }

    function saveOrder(appids: number[]) {
        fetch('/api/order/playlist', {
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
            const ids      = Object.entries(flags as Record<string, any>).filter(([, f]) => f.playlist).map(([id]) => Number(id)).filter(appid => shouldShow(appid))

            if (!ids.length) { loading = false; return }

            // Render immediately with available data
            const base    = ids.map(appid => {
                const o = ownedMap.get(appid)
                return { appid, name: o?.name ?? `App ${appid}`, playtime: o?.playtime_forever ?? 0 } as SteamGame
            })
            const sorted  = base.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
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

<div class="playing-header">
    <div class="playing-header-body">
        <p class="playing-eyebrow">Play List</p>
        <h1 class="playing-title">Playing</h1>
        <p class="playing-subtitle">{subtitle}</p>
    </div>
</div>

{#if current}
    <div class="playing-current-wrap">
        <a class="playing-current" class:playing-current--live={currentIsLive}
           href="/game/{current.appid}" data-game-card data-appid={current.appid} data-game-name={current.name}>
            <div class="playing-current-bg" style="background-image:url('/relay/images/steam/games/{current.appid}/header.jpg')"></div>
            <div class="playing-current-scrim"></div>
            <div class="playing-current-body">
                <span class="playing-current-eyebrow">
                    {#if currentIsLive}<span class="playing-current-dot"></span>Now Playing{:else}Last Session{/if}
                </span>
                <span class="playing-current-title">{current.name}</span>
                {#if currentIsLive && currentElapsed}<span class="playing-current-time">{currentElapsed}</span>{/if}
            </div>
        </a>
    </div>
{/if}

{#if loading}
    <p class="page-loading">Loading play list…</p>
{:else if error}
    <p class="page-error">Failed to load play list: {error}</p>
{:else if !games.length}
    <p class="page-empty" style="padding:40px">
        Your play list is empty. Open any game page and use the
        <strong>Add to Play List</strong> toggle to queue up what you want to play next.
    </p>
{:else}
    <div class="playing-queue">
        <div class="playing-queue-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <span class="playing-queue-label">Up Next</span>
            <span class="playing-queue-hint">Drag to reorder</span>
        </div>
        <div class="playing-queue-row">
            {#each queueGames as g, i (g.appid)}
                {@const prog    = progressData(g)}
                {@const playedH = fmtHours(g.playtime)}
                <a class="playing-card playing-card--up-next"
                   class:playing-card--dragging={g.appid === draggedAppid}
                   class:playing-card--drop-before={dropTargetAppid === g.appid && dropSide === 'before'}
                   class:playing-card--drop-after={dropTargetAppid === g.appid && dropSide === 'after'}
                   href="/game/{g.appid}" data-game-card data-appid={g.appid} data-game-name={g.name} draggable="true"
                   ondragstart={() => onDragStart(g.appid)}
                   ondragend={onDragEnd}
                   ondragover={(e) => onDragOver(e, g.appid)}
                   ondragleave={onDragLeave}
                   ondrop={(e) => onDrop(e, g.appid)}>
                    <div class="playing-card-img-wrap">
                        <img class="playing-card-img"
                             src="/relay/images/steam/games/{g.appid}/header.jpg"
                             alt="" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                        <div class="playing-card-overlay"></div>
                        <span class="playing-card-num">{i + 1}</span>
                        {#if playedH}<span class="playing-card-time" title="Time played so far">{playedH}</span>{/if}
                    </div>
                    <div class="playing-card-body">
                        <span class="playing-card-name">{g.name}</span>
                        {#if prog?.label}<span class="playing-card-progress-label">{prog.label}</span>{/if}
                    </div>
                    {#if prog}
                        <div class="playing-bar-wrap">
                            <div class="playing-bar-track">
                                <div class="playing-bar-fill" style="width:{prog.fillPct}%"></div>
                                {#each prog.ticks as tick}
                                    <span class="playing-bar-tick" style="left:{tick.pct.toFixed(1)}%" title="{tick.label}"></span>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </a>
            {/each}
        </div>
    </div>
    {#if restGames.length}
        <div class="playing-rest-sep">
            <span class="playing-rest-sep-label">Queue &middot; {restGames.length} more</span>
        </div>
        <div class="playing-grid">
            {#each restGames as g, i (g.appid)}
                {@const prog    = progressData(g)}
                {@const playedH = fmtHours(g.playtime)}
                <a class="playing-card"
                   class:playing-card--dragging={g.appid === draggedAppid}
                   class:playing-card--drop-before={dropTargetAppid === g.appid && dropSide === 'before'}
                   class:playing-card--drop-after={dropTargetAppid === g.appid && dropSide === 'after'}
                   href="/game/{g.appid}" data-game-card data-appid={g.appid} data-game-name={g.name} draggable="true"
                   ondragstart={() => onDragStart(g.appid)}
                   ondragend={onDragEnd}
                   ondragover={(e) => onDragOver(e, g.appid)}
                   ondragleave={onDragLeave}
                   ondrop={(e) => onDrop(e, g.appid)}>
                    <div class="playing-card-img-wrap">
                        <img class="playing-card-img"
                             src="/relay/images/steam/games/{g.appid}/header.jpg"
                             alt="" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                        <div class="playing-card-overlay"></div>
                        <span class="playing-card-num">{i + 4}</span>
                        {#if playedH}<span class="playing-card-time" title="Time played so far">{playedH}</span>{/if}
                    </div>
                    <div class="playing-card-body">
                        <span class="playing-card-name">{g.name}</span>
                        {#if prog?.label}<span class="playing-card-progress-label">{prog.label}</span>{/if}
                    </div>
                    {#if prog}
                        <div class="playing-bar-wrap">
                            <div class="playing-bar-track">
                                <div class="playing-bar-fill" style="width:{prog.fillPct}%"></div>
                                {#each prog.ticks as tick}
                                    <span class="playing-bar-tick" style="left:{tick.pct.toFixed(1)}%" title="{tick.label}"></span>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </a>
            {/each}
        </div>
    {/if}
{/if}
