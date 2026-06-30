<script lang="ts">
    import { onMount } from 'svelte'
    import Breadcrumb from '../../Breadcrumb.svelte'

    let { appid }: { appid: string } = $props()

    interface DownloadedGuide {
        source: string
        guideId: string
        title: string
        author: string | null
        parsedAt: string | null
        pageCount: number
        sizeBytes: number
    }

    let gameName = $state('')
    let guides   = $state<DownloadedGuide[]>([])
    let loading  = $state(true)
    let error    = $state<string | null>(null)

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8', gamerguides: 'Gamer Guides', fandom: 'Fandom' }
    const SOURCE_ICONS:  Record<string, string> = { gamefaqs: '/images/guides/gamefaqs.webp', ign: '/images/guides/ign.webp', steam: '/images/guides/steam.webp', game8: '/images/guides/game8.webp', gamerguides: '/images/guides/gamerguides.webp', fandom: '/images/guides/fandom.webp' }

    function fmtDate(iso: string | null): string {
        if (!iso) return '—'
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }

    function fmtBytes(n: number): string {
        if (!n) return ''
        if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
        return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    onMount(async () => {
        try {
            const [gameRes, guidesRes] = await Promise.allSettled([
                fetch(`/relay/api/games/${appid}`).then(r => r.ok ? r.json() : null),
                fetch(`/relay/api/guides/${appid}`).then(r => r.ok ? r.json() : []),
            ])
            gameName = (gameRes as PromiseFulfilledResult<any>).value?.name ?? ''
            guides   = (guidesRes as PromiseFulfilledResult<any>).value ?? []
        } catch {
            error = 'Failed to load guides.'
        } finally {
            loading = false
        }
    })
</script>

<svelte:head><title>{gameName ? `Guides — ${gameName}` : 'Guides'}</title></svelte:head>

{#if loading}
    <p class="page-loading">Loading guides…</p>
{:else if error}
    <p class="page-error">{error}</p>
{:else}
<div class="gj-sub-wrap">
    <div class="gj-header">
        <Breadcrumb crumbs={[
            { label: 'Home', href: '/' },
            { label: gameName || appid, href: `/game/${appid}` },
            { label: 'Journal', href: `/journal/${appid}` },
            { label: 'Guides' },
        ]} />
        <span class="gj-header-title">Guides</span>
    </div>

    {#if guides.length === 0}
        <p class="gj-no-data">No guides downloaded yet. Use the Guides card on the journal dashboard to find and download guides.</p>
    {:else}
        <div class="gl-grid">
            {#each guides as g}
                <a class="gl-card" href="/journal/{appid}/guides/{g.source}/{g.guideId}">
                    <div class="gl-card-source">
                        {#if SOURCE_ICONS[g.source]}
                            <img class="gl-card-source-icon" src={SOURCE_ICONS[g.source]} alt="">
                        {/if}
                        {SOURCE_LABELS[g.source] ?? g.source}
                    </div>
                    <div class="gl-card-title">{g.title}</div>
                    {#if g.author}
                        <div class="gl-card-author">by {g.author}</div>
                    {/if}
                    <div class="gl-card-meta">
                        <span class="gl-card-pages">{g.pageCount} {g.pageCount === 1 ? 'page' : 'pages'}</span>
                        {#if g.sizeBytes}
                            <span class="gl-card-sep">·</span>
                            <span class="gl-card-size">{fmtBytes(g.sizeBytes)}</span>
                        {/if}
                        <span class="gl-card-sep">·</span>
                        <span class="gl-card-date">Added {fmtDate(g.parsedAt)}</span>
                    </div>
                </a>
            {/each}
        </div>
    {/if}
</div>
{/if}
