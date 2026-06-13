<script lang="ts">
    import type { SteamUserReviewEntry } from '../../../types.js'
    import { fmtCount } from '../../../js/views/game-render.js'

    const SVG_THUMB_UP   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`
    const SVG_THUMB_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`

    interface Props { entry?: SteamUserReviewEntry | null }
    let { entry }: Props = $props()

    let r = $derived(entry?.review ?? null)

    let expanded = $state(false)

    let date = $derived.by(() => {
        if (!r) return null
        if (r.timestamp_created) return new Date(r.timestamp_created * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        if (entry?.fetchedAt)    return new Date(entry.fetchedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        return null
    })

    let hours   = $derived(r?.author?.playtime_at_review != null ? Math.round(r.author.playtime_at_review / 60) : null)
    let helpful = $derived((r?.votes_up ?? 0) > 0 ? `${fmtCount(r!.votes_up)} found helpful` : null)
</script>

{#if r}
    <section class="game-section" id="game-sec-steam-review">
        <h2 class="game-section-title">Steam Review</h2>
        <div class="rev-mine">
            <div class="rev-mine-header">
                <span class="rev-card-thumb" class:rev-card-thumb--pos={r.voted_up} class:rev-card-thumb--neg={!r.voted_up}>
                    {@html r.voted_up ? SVG_THUMB_UP : SVG_THUMB_DOWN}
                </span>
                <span class="rev-mine-verdict">{r.voted_up ? 'Recommended' : 'Not Recommended'}</span>
                <div class="rev-mine-meta">
                    {#if hours != null}<span class="rev-card-hours">{hours.toLocaleString()}h at review</span>{/if}
                    {#if date}<span class="rev-card-date">{date}</span>{/if}
                    {#if r.written_during_early_access}<span class="rev-card-badge">Early Access</span>{/if}
                </div>
                {#if helpful}<span class="rev-card-helpful rev-mine-helpful">{helpful}</span>{/if}
                {#if r.review}
                    <button class="rev-mine-show-more" onclick={() => expanded = !expanded}>
                        {expanded ? 'Hide review' : 'Show review'}
                    </button>
                {/if}
            </div>
            {#if r.review && expanded}
                <div class="rev-mine-body">
                    <p class="rev-mine-text">{r.review}</p>
                </div>
            {/if}
        </div>
    </section>
{/if}
