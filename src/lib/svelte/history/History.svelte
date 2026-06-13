<script lang="ts">
    import { onMount } from 'svelte'
    import type { SteamGame } from '../../types.js'
    import { loadGameFilter } from '../../js/views/game-filter.js'

    interface HistoryEntry {
        appid:        number
        name:         string
        playtime:     number
        lastPlayedAt: string | null
    }

    let games   = $state<HistoryEntry[]>([])
    let loading = $state(true)
    let error   = $state<string | null>(null)

    let topGames  = $derived(games.slice(0, 3))
    let restGames = $derived(games.slice(3))
    let subtitle  = $derived(
        games.length
            ? `${games.length} game${games.length !== 1 ? 's' : ''} · last played ${fmtRelative(games[0].lastPlayedAt)}`
            : ''
    )

    function fmtHours(mins: number) {
        if (!mins) return null
        const h = mins / 60
        if (h < 1)  return `${Math.round(mins)}m`
        if (h < 10) return `${h.toFixed(1)}h`
        return `${Math.round(h)}h`
    }

    function fmtRelative(isoStr: string | null | undefined) {
        if (!isoStr) return null
        const diffMs  = Date.now() - new Date(isoStr).getTime()
        const diffMin = Math.floor(diffMs / 60_000)
        if (diffMin < 2)   return 'Just now'
        if (diffMin < 60)  return `${diffMin}m ago`
        const diffH = Math.floor(diffMin / 60)
        if (diffH < 24)    return `${diffH}h ago`
        const diffD = Math.floor(diffH / 24)
        if (diffD < 7)     return `${diffD}d ago`
        if (diffD < 31)    return `${Math.floor(diffD / 7)}w ago`
        return new Date(isoStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    }

    onMount(async () => {
        try {
            const [lastPlayedRes, gamesRes, shouldShow] = await Promise.all([
                fetch('/relay/api/steam/playtime/last-played'),
                fetch('/relay/api/steam/games'),
                loadGameFilter(),
            ])
            if (!lastPlayedRes.ok) throw new Error(`Last-played HTTP ${lastPlayedRes.status}`)
            if (!gamesRes.ok)      throw new Error(`Games HTTP ${gamesRes.status}`)

            const lastPlayedMap = await lastPlayedRes.json() as Record<string, any>
            const gamesRaw      = await gamesRes.json()
            const owned         = Array.isArray(gamesRaw) ? gamesRaw : (gamesRaw.games ?? [])
            const gameInfoMap   = new Map<number, SteamGame>((owned as SteamGame[]).map(g => [g.appid, g]))

            games = Object.entries(lastPlayedMap)
                .map(([appidStr, data]) => {
                    const appid = Number(appidStr)
                    const info  = gameInfoMap.get(appid)
                    return {
                        appid,
                        name:         info?.name ?? `App ${appid}`,
                        playtime:     data.effectiveMin ?? 0,
                        lastPlayedAt: data.lastPlayedAt ?? null,
                    }
                })
                .filter(g => g.lastPlayedAt && shouldShow(g.appid))
                .sort((a, b) => new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime())
        } catch (err) {
            error = (err as Error).message
        } finally {
            loading = false
        }
    })
</script>

{#if loading}
    <p class="page-loading">Loading…</p>
{:else if error}
    <p class="page-error">Failed to load history: {error}</p>
{:else}
    <div class="history-header">
        <div class="history-header-body">
            <p class="history-eyebrow">Activity</p>
            <h1 class="history-title">History</h1>
            {#if games.length}<p class="history-subtitle">{subtitle}</p>{/if}
        </div>
    </div>
    {#if !games.length}
        <p class="page-empty" style="padding:40px">No play history recorded yet.</p>
    {:else}
        <div class="history-recent">
            <div class="history-recent-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span class="history-recent-label">Recently Played</span>
            </div>
            <div class="history-recent-row">
                {#each topGames as g, i (g.appid)}
                    {@const relLabel = fmtRelative(g.lastPlayedAt)}
                    {@const ptLabel  = fmtHours(g.playtime)}
                    <a class="history-card history-card--featured" href="/game/{g.appid}">
                        <div class="history-card-img-wrap">
                            <img class="history-card-img"
                                 src="/relay/images/steam/games/{g.appid}/header.jpg"
                                 alt="" loading="lazy"
                                 onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                            <div class="history-card-overlay"></div>
                            <span class="history-card-num">{i + 1}</span>
                            {#if relLabel}<span class="history-card-time">{relLabel}</span>{/if}
                        </div>
                        <div class="history-card-body">
                            <span class="history-card-name">{g.name}</span>
                            {#if ptLabel}<span class="history-card-played">{ptLabel} played</span>{/if}
                        </div>
                    </a>
                {/each}
            </div>
        </div>
        {#if restGames.length}
            <div class="history-rest-sep">
                <span class="history-rest-sep-label">Earlier &middot; {restGames.length} more</span>
            </div>
            <div class="history-grid">
                {#each restGames as g, i (g.appid)}
                    {@const relLabel = fmtRelative(g.lastPlayedAt)}
                    {@const ptLabel  = fmtHours(g.playtime)}
                    <a class="history-card" href="/game/{g.appid}">
                        <div class="history-card-img-wrap">
                            <img class="history-card-img"
                                 src="/relay/images/steam/games/{g.appid}/header.jpg"
                                 alt="" loading="lazy"
                                 onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                            <div class="history-card-overlay"></div>
                            <span class="history-card-num">{i + 4}</span>
                            {#if relLabel}<span class="history-card-time">{relLabel}</span>{/if}
                        </div>
                        <div class="history-card-body">
                            <span class="history-card-name">{g.name}</span>
                            {#if ptLabel}<span class="history-card-played">{ptLabel} played</span>{/if}
                        </div>
                    </a>
                {/each}
            </div>
        {/if}
    {/if}
{/if}
