<script lang="ts">
    import { onMount } from 'svelte'
    import { navigate } from '../../js/router.js'
    import type { LocalReview, SteamGame } from '../../types.js'

    let allEntries = $state<[string, LocalReview][]>([])
    let gamesMap   = $state<Record<string, SteamGame>>({})
    let loading    = $state(true)
    let error      = $state<string | null>(null)
    let search     = $state('')
    let sortBy     = $state('stars')

    let filtered = $derived.by(() => {
        const q = search.toLowerCase().trim()
        let entries = allEntries.filter(([appid, rev]) => {
            if (!q) return true
            const name = (gamesMap[String(appid)]?.name ?? '').toLowerCase()
            const tags = (rev.tags ?? []).map(t => t.toLowerCase())
            return name.includes(q) || tags.some(t => t.includes(q))
        })
        return entries.sort(([aId, aRev], [bId, bRev]) => {
            if (sortBy === 'stars') {
                const diff = (bRev.stars ?? 0) - (aRev.stars ?? 0)
                if (diff !== 0) return diff
                return (gamesMap[String(aId)]?.name ?? '').localeCompare(gamesMap[String(bId)]?.name ?? '')
            }
            if (sortBy === 'name')
                return (gamesMap[String(aId)]?.name ?? '').localeCompare(gamesMap[String(bId)]?.name ?? '')
            if (sortBy === 'recent')
                return (bRev.updatedAt ?? '').localeCompare(aRev.updatedAt ?? '')
            return 0
        })
    })

    onMount(async () => {
        let reviews = {}
        let gm: Record<string, any> = {}
        try {
            const [reviewsRes, gamesRes] = await Promise.all([
                fetch('/api/local-reviews'),
                fetch('/relay/api/steam/games'),
            ])
            if (reviewsRes.ok) reviews = await reviewsRes.json()
            if (gamesRes.ok) {
                const raw = await gamesRes.json()
                const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.games) ? raw.games : []
                for (const g of arr) { if (g?.appid) gm[String(g.appid)] = g }
            }
        } catch (err) {
            error = (err as Error).message
            loading = false
            return
        }
        gamesMap   = gm
        allEntries = Object.entries(reviews)
        loading    = false
    })
</script>

{#if loading}
    <p class="page-loading">Loading reviews…</p>
{:else if error}
    <p class="page-error">Failed to load reviews: {error}</p>
{:else if allEntries.length === 0}
    <div class="mr-header">
        <div class="mr-header-eyebrow">Collection</div>
        <h1>My Reviews</h1>
    </div>
    <div class="mr-grid">
        <div class="mr-empty">
            <div class="mr-empty-title">No reviews yet</div>
            <div class="mr-empty-sub">Visit a game page and write your first review.</div>
        </div>
    </div>
{:else}
    <div class="mr-header">
        <div class="mr-header-eyebrow">Collection</div>
        <h1>My Reviews</h1>
    </div>
    <div class="mr-controls">
        <input class="mr-search" type="search" placeholder="Search by name or tag…"
               bind:value={search}>
        <select class="mr-sort" bind:value={sortBy}>
            <option value="stars">By Stars</option>
            <option value="name">By Name</option>
            <option value="recent">Recently Reviewed</option>
        </select>
    </div>
    <div class="mr-grid">
        {#if filtered.length === 0}
            <div class="mr-empty">
                <div class="mr-empty-title">No results</div>
                <div class="mr-empty-sub">Try a different search.</div>
            </div>
        {:else}
            {#each filtered as [appid, rev] (appid)}
                {@const name    = gamesMap[String(appid)]?.name ?? `App ${appid}`}
                {@const stars   = rev.stars ?? 0}
                {@const tags    = rev.tags ?? []}
                {@const excerpt = rev.review ?? ''}
                <a class="mr-card" href="/game/{appid}"
                   onclick={(e) => { e.preventDefault(); navigate(`game/${appid}`) }}>
                    <div class="mr-card-img-wrap">
                        <img class="mr-card-img{stars === 0 ? ' mr-card-img--unrated' : ''}"
                             src="/relay/images/steam/games/{appid}/header.jpg"
                             alt={name}
                             onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3' }}>
                        {#if stars > 0}
                            <div class="mr-card-stars">
                                {#each Array.from({ length: Math.min(stars, 6) }, (_, i) => i + 1) as i}
                                    {#if i === 6}
                                        <span class="mr-card-star mr-card-star--legendary">✦</span>
                                    {:else}
                                        <span class="mr-card-star">★</span>
                                    {/if}
                                {/each}
                            </div>
                        {/if}
                    </div>
                    <div class="mr-card-body">
                        <div class="mr-card-name">{name}</div>
                        {#if tags.length > 0}
                            <div class="mr-card-tags">
                                {#each tags.slice(0, 3) as tag}
                                    <span class="mr-card-tag">{tag}</span>
                                {/each}
                            </div>
                        {/if}
                        {#if excerpt}
                            <div class="mr-card-excerpt">{excerpt}</div>
                        {/if}
                    </div>
                </a>
            {/each}
        {/if}
    </div>
{/if}
