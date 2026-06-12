<script>
    import { onMount } from 'svelte'

    let games           = $state([])
    let loading         = $state(true)
    let error           = $state(null)
    let pickedAppid     = $state(null)
    let draggedAppid    = $state(null)
    let dropTargetAppid = $state(null)
    let dropSide        = $state(null)   // 'before' | 'after'

    let queueGames = $derived(games.slice(0, 3))
    let restGames  = $derived(games.slice(3))
    let totalH     = $derived(games.reduce((sum, g) => {
        const main = g.hltb?.gameplayMain ?? g.hltb?.mainStory ?? null
        return sum + (main ?? 0)
    }, 0))
    let subtitle = $derived(
        totalH > 0
            ? `~${Math.round(totalH)}h of games waiting`
            : `${games.length} game${games.length !== 1 ? 's' : ''} waiting`
    )

    function fmtHours(mins) {
        if (!mins) return null
        const h = mins / 60
        if (h < 1)  return `${Math.round(mins)}m`
        if (h < 10) return `${h.toFixed(1)}h`
        return `${Math.round(h)}h`
    }

    function hltbLabel(hltb) {
        const main = hltb?.gameplayMain ?? hltb?.mainStory ?? null
        if (main) return fmtHours(main * 60)
        const comp = hltb?.gameplayCompletionist ?? hltb?.completionist ?? null
        if (comp) return fmtHours(comp * 60)
        return null
    }

    async function loadOrder() {
        try {
            const res = await fetch('/api/order/backlog')
            if (!res.ok) return []
            const data = await res.json()
            return Array.isArray(data) ? data : []
        } catch { return [] }
    }

    function saveOrder(appids) {
        fetch('/api/order/backlog', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(appids),
        }).catch(() => {})
    }

    function randomPick() {
        if (!games.length) return
        const pick = games[Math.floor(Math.random() * games.length)]
        pickedAppid = pick.appid
    }

    // ── Drag handlers ─────────────────────────────────────────────────────────

    function onDragStart(appid) {
        requestAnimationFrame(() => { draggedAppid = appid })
    }

    function onDragEnd() {
        draggedAppid    = null
        dropTargetAppid = null
        dropSide        = null
    }

    function onDragOver(e, appid) {
        e.preventDefault()
        if (draggedAppid === null || draggedAppid === appid) return
        const rect = e.currentTarget.getBoundingClientRect()
        dropTargetAppid = appid
        dropSide        = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    }

    function onDragLeave(e) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
            dropTargetAppid = null
            dropSide        = null
        }
    }

    function onDrop(e, targetAppid) {
        e.preventDefault()
        if (draggedAppid === null || draggedAppid === targetAppid) return
        const isBefore = dropSide === 'before'
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
            const [flagsRes, gamesRes] = await Promise.all([
                fetch('/api/flags'),
                fetch('/relay/api/steam/games'),
            ])
            if (!flagsRes.ok) throw new Error(`Flags HTTP ${flagsRes.status}`)
            if (!gamesRes.ok) throw new Error(`Games HTTP ${gamesRes.status}`)

            const flags    = await flagsRes.json()
            const gamesRaw = await gamesRes.json()
            const owned    = Array.isArray(gamesRaw) ? gamesRaw : (gamesRaw.games ?? [])
            const ownedMap = new Map(owned.map(g => [g.appid, g]))
            const ids      = Object.entries(flags).filter(([, f]) => f.backlog).map(([id]) => Number(id))

            if (!ids.length) { loading = false; return }

            const results = await Promise.all(ids.map(async appid => {
                const o       = ownedMap.get(appid)
                let name      = o?.name ?? null
                let playtime  = o?.playtime_forever ?? 0
                let hltb      = null

                try { const r = await fetch(`/relay/api/hltb/${appid}`);    if (r.ok) hltb = await r.json() } catch {}
                if (!name) {
                    try { const r = await fetch(`/relay/api/games/${appid}`); if (r.ok) { const d = await r.json(); name = d?.name ?? null } } catch {}
                }
                return { appid, name: name ?? `App ${appid}`, hltb, playtime }
            }))

            const sorted  = results.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
            const order   = await loadOrder()
            const gameMap = new Map(sorted.map(g => [g.appid, g]))
            const ordered = []
            const seen    = new Set()
            for (const appid of order) {
                if (gameMap.has(appid)) { ordered.push(gameMap.get(appid)); seen.add(appid) }
            }
            for (const g of sorted) { if (!seen.has(g.appid)) ordered.push(g) }
            games = ordered
        } catch (err) {
            error = err.message
        } finally {
            loading = false
        }
    })
</script>

{#if loading}
    <p class="page-loading">Loading backlog…</p>
{:else if error}
    <p class="page-error">Failed to load backlog: {error}</p>
{:else}
    <div class="backlog-header">
        <div class="backlog-header-body">
            <p class="backlog-eyebrow">Collection</p>
            <h1 class="backlog-title">Backlog</h1>
            {#if games.length}<p class="backlog-subtitle">{subtitle}</p>{/if}
        </div>
        {#if games.length}
            <button class="backlog-random-btn" title="Pick a random game from your backlog" onclick={randomPick}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
                    <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
                </svg>
                Random Pick
            </button>
        {/if}
    </div>
    {#if !games.length}
        <p class="page-empty" style="padding:40px">
            No games in your backlog yet. Open any game page and toggle the
            <strong>Backlog</strong> flag to add it here.
        </p>
    {:else}
        <div class="backlog-queue">
            <div class="backlog-queue-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span class="backlog-queue-label">Up Next</span>
                <span class="backlog-queue-hint">Drag to reorder</span>
            </div>
            <div class="backlog-queue-row">
                {#each queueGames as g, i (g.appid)}
                    {@const est    = hltbLabel(g.hltb)}
                    {@const ptH    = g.playtime > 0 ? fmtHours(g.playtime) : null}
                    <a class="backlog-card backlog-card--up-next"
                       class:backlog-card--dragging={g.appid === draggedAppid}
                       class:backlog-card--drop-before={dropTargetAppid === g.appid && dropSide === 'before'}
                       class:backlog-card--drop-after={dropTargetAppid === g.appid && dropSide === 'after'}
                       class:backlog-card--picked={pickedAppid === g.appid}
                       href="/game/{g.appid}" data-appid={g.appid} draggable="true"
                       ondragstart={() => onDragStart(g.appid)}
                       ondragend={onDragEnd}
                       ondragover={(e) => onDragOver(e, g.appid)}
                       ondragleave={onDragLeave}
                       ondrop={(e) => onDrop(e, g.appid)}>
                        <div class="backlog-card-img-wrap">
                            <img class="backlog-card-img"
                                 src="/relay/images/steam/games/{g.appid}/header.jpg"
                                 alt="" loading="lazy" onerror={(e) => { e.currentTarget.style.opacity = '0' }}>
                            <div class="backlog-card-overlay"></div>
                            <span class="backlog-card-num">{i + 1}</span>
                            {#if est}
                                <span class="backlog-card-time backlog-card-time--hltb" title="HowLongToBeat estimate">{est}</span>
                            {:else}
                                <span class="backlog-card-time backlog-card-time--unknown">?h</span>
                            {/if}
                        </div>
                        <div class="backlog-card-body">
                            <span class="backlog-card-name">{g.name}</span>
                            {#if ptH}<span class="backlog-card-played" title="Time played in Steam">{ptH} played</span>{/if}
                        </div>
                    </a>
                {/each}
            </div>
        </div>
        {#if restGames.length}
            <div class="backlog-rest-sep">
                <span class="backlog-rest-sep-label">Queue &middot; {restGames.length} more</span>
            </div>
            <div class="backlog-grid">
                {#each restGames as g (g.appid)}
                    {@const est = hltbLabel(g.hltb)}
                    {@const ptH = g.playtime > 0 ? fmtHours(g.playtime) : null}
                    <a class="backlog-card"
                       class:backlog-card--dragging={g.appid === draggedAppid}
                       class:backlog-card--drop-before={dropTargetAppid === g.appid && dropSide === 'before'}
                       class:backlog-card--drop-after={dropTargetAppid === g.appid && dropSide === 'after'}
                       class:backlog-card--picked={pickedAppid === g.appid}
                       href="/game/{g.appid}" data-appid={g.appid} draggable="true"
                       ondragstart={() => onDragStart(g.appid)}
                       ondragend={onDragEnd}
                       ondragover={(e) => onDragOver(e, g.appid)}
                       ondragleave={onDragLeave}
                       ondrop={(e) => onDrop(e, g.appid)}>
                        <div class="backlog-card-img-wrap">
                            <img class="backlog-card-img"
                                 src="/relay/images/steam/games/{g.appid}/header.jpg"
                                 alt="" loading="lazy" onerror={(e) => { e.currentTarget.style.opacity = '0' }}>
                            <div class="backlog-card-overlay"></div>
                            {#if est}
                                <span class="backlog-card-time backlog-card-time--hltb" title="HowLongToBeat estimate">{est}</span>
                            {:else}
                                <span class="backlog-card-time backlog-card-time--unknown">?h</span>
                            {/if}
                        </div>
                        <div class="backlog-card-body">
                            <span class="backlog-card-name">{g.name}</span>
                            {#if ptH}<span class="backlog-card-played" title="Time played in Steam">{ptH} played</span>{/if}
                        </div>
                    </a>
                {/each}
            </div>
        {/if}
    {/if}
{/if}
