<script lang="ts">
    import { onMount } from 'svelte'
    import { goto } from '$app/navigation'
    import Breadcrumb from '../../Breadcrumb.svelte'

    let { appid }: { appid: string } = $props()

    // lucide refresh-cw — matches SVG_SYNC in GameHero.svelte
    const SVG_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`

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

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8', gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker', thegamer: 'TheGamer' }
    const SOURCE_ICONS:  Record<string, string> = { gamefaqs: '/images/guides/gamefaqs.webp', ign: '/images/guides/ign.webp', steam: '/images/guides/steam.webp', game8: '/images/guides/game8.webp', gamerguides: '/images/guides/gamerguides.webp', fandom: '/images/guides/fandom.webp', neoseeker: '/images/guides/neoseeker.webp', thegamer: '/images/guides/thegamer.webp' }

    function fmtDate(iso: string | null): string {
        if (!iso) return '—'
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }

    function fmtBytes(n: number): string {
        if (!n) return ''
        if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
        return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    // guideId of the card whose reparse request is in flight — prevents a double-click
    // enqueueing twice while the POST is still on the wire.
    let reparsing = $state<string | null>(null)

    async function reparse(g: DownloadedGuide) {
        if (reparsing) return
        reparsing = g.guideId
        try {
            const res = await fetch('/relay/api/guides/jobs', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    steamId: appid, source: g.source, guideId: g.guideId,
                    gameName, mode: 'reparse',
                }),
            })
            if (!res.ok) {
                error = 'Could not start the re-parse.'
                return
            }
            // Land on Downloads so the job's progress is actually visible.
            await goto('/downloads')
        } catch {
            error = 'Could not start the re-parse.'
        } finally {
            reparsing = null
        }
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
                <!-- The refresh button is a SIBLING of the card link, not a child: a button
                     nested inside an <a> is invalid, and SvelteKit intercepts link clicks on
                     the capture phase, so a child's own handler can't reliably stop it. -->
                <div class="gl-card-wrap">
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
                <button
                    class="gl-card-refresh"
                    class:gl-card-refresh--busy={reparsing === g.guideId}
                    disabled={reparsing !== null}
                    title="Re-parse this guide from the saved pages"
                    aria-label="Re-parse {g.title}"
                    onclick={() => reparse(g)}
                >
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html SVG_REFRESH}
                </button>
                </div>
            {/each}
        </div>
    {/if}
</div>
{/if}
