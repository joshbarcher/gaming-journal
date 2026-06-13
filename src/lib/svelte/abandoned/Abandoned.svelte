<script lang="ts">
    import { onMount } from 'svelte'
    import type { SteamGame } from '../../types.js'

    let games   = $state<SteamGame[]>([])
    let loading = $state(true)
    let error   = $state<string | null>(null)

    let totalMin = $derived(games.reduce((s, g) => s + (g.playtime ?? 0), 0))
    let subtitle = $derived(
        totalMin > 0
            ? `${games.length} game${games.length !== 1 ? 's' : ''} set aside · ${fmtHours(totalMin)} invested`
            : `${games.length} game${games.length !== 1 ? 's' : ''} set aside`
    )

    function fmtHours(mins: number | null | undefined) {
        if (!mins) return null
        const h = mins / 60
        if (h < 1)  return `${Math.round(mins)}m`
        if (h < 10) return `${h.toFixed(1)}h`
        return `${Math.round(h)}h`
    }

    function remainingLabel(hltb: SteamGame['hltb'], playtimeMin: number) {
        const mainH = hltb?.gameplayMain ?? hltb?.mainStory ?? null
        if (!mainH) return null
        const remaining = mainH * 60 - playtimeMin
        if (remaining <= 0) return null
        return fmtHours(remaining)
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
            const ownedMap = new Map<number, SteamGame>(owned.map((g: SteamGame) => [g.appid, g]))
            const ids      = Object.entries(flags as Record<string, any>).filter(([, f]) => f.dropped).map(([id]) => Number(id))

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
                return { appid, name: name ?? `App ${appid}`, playtime, hltb }
            }))

            games = results.sort((a, b) => b.playtime - a.playtime)
        } catch (err) {
            error = (err as Error).message
        } finally {
            loading = false
        }
    })
</script>

{#if loading}
    <p class="page-loading">Loading abandoned saves…</p>
{:else if error}
    <p class="page-error">Failed to load: {error}</p>
{:else}
    <div class="ab-header">
        <div class="ab-header-body">
            <p class="ab-eyebrow">Collection</p>
            <h1 class="ab-title">Abandoned</h1>
            {#if games.length}<p class="ab-subtitle">{subtitle}</p>{/if}
        </div>
    </div>
    {#if !games.length}
        <p class="page-empty" style="padding:40px">
            No dropped games yet. Open any game page and toggle the
            <strong>Dropped</strong> flag to track it here.
        </p>
    {:else}
        <div class="ab-grid">
            {#each games as g (g.appid)}
                {@const invested  = fmtHours(g.playtime)}
                {@const remaining = remainingLabel(g.hltb, g.playtime ?? 0)}
                <a class="ab-card" href="/game/{g.appid}" data-appid={g.appid}>
                    <div class="ab-card-img-wrap">
                        <img class="ab-card-img"
                             src="/relay/images/steam/games/{g.appid}/header.jpg"
                             alt="" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                        <div class="ab-card-fog"></div>
                        <div class="ab-card-overlay"></div>
                        {#if invested}<span class="ab-card-invested">{invested} in</span>{/if}
                    </div>
                    <div class="ab-card-body">
                        <span class="ab-card-name">{g.name}</span>
                        {#if remaining}
                            <span class="ab-card-meta">
                                <span class="ab-card-remaining" title="Estimated time remaining">{remaining} left</span>
                                to finish
                            </span>
                        {:else}
                            <span class="ab-card-meta ab-card-meta--unknown">Unfinished</span>
                        {/if}
                    </div>
                </a>
            {/each}
        </div>
    {/if}
{/if}
