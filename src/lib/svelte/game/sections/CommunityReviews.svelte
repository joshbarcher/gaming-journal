<script lang="ts">
    import type { SteamGame, CommunityReviews } from '../../../types.js'
    import { releaseStatus, fmtCount } from '../../../js/views/game-render.js'

    const SVG_THUMB_UP   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`
    const SVG_THUMB_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`

    interface Props {
        data?: CommunityReviews | null
        game:  SteamGame
    }
    let { data, game }: Props = $props()

    let show = $derived(releaseStatus(game) !== 'coming_soon')

    function ratioColor(pct: number) {
        return pct >= 80 ? 'var(--clr-review-pos)' : pct >= 60 ? 'var(--clr-review-mix)' : 'var(--clr-review-neg)'
    }
</script>

{#if show}
    <section class="game-section" id="game-sec-community-reviews">
        <h2 class="game-section-title">Community Reviews</h2>

        {#if !data?.totalReviews}
            <p class="game-section-empty">
                {data === null ? 'Loading community reviews…' : 'No community reviews on Steam yet.'}
            </p>
        {:else}
            {#if data.summary && (data.totalReviews ?? 0) > 0}
                {@const s = data.summary}
                {@const pct = Math.round(s.ratio ?? 0)}
                {@const color = ratioColor(pct)}
                <div class="rev-summary">
                    <div class="rev-summary-score">
                        <span class="rev-summary-desc">{s.scoreDesc ?? ''}</span>
                        <span class="rev-summary-counts">
                            {fmtCount(s.totalPositive)} positive · {fmtCount(s.totalNegative)} negative · {fmtCount(data.totalReviews)} total
                        </span>
                    </div>
                    {#if s.ratio != null}
                        <div class="rev-ratio-wrap">
                            <div class="rev-ratio-bar">
                                <div class="rev-ratio-fill" style="width:{pct}%;background:{color}"></div>
                            </div>
                            <span class="rev-ratio-pct" style="color:{color}">{pct}%</span>
                        </div>
                    {/if}
                </div>
            {/if}

            {#if data.reviews?.length}
                <div class="rev-list">
                    {#each data.reviews as r}
                        {@const date     = new Date(r.postedAt ?? r.fetchedAt ?? Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        {@const hours    = r.hoursAtReview ?? (r.review ? Math.round((r.review.author?.playtime_at_review ?? 0) / 60) : null)}
                        {@const helpful  = (r.votesUp ?? 0) > 0 ? `${fmtCount(r.votesUp)} found helpful` : ''}
                        <div class="rev-card">
                            <div class="rev-card-header">
                                <span class="rev-card-thumb" class:rev-card-thumb--pos={r.votedUp} class:rev-card-thumb--neg={!r.votedUp}>
                                    {@html r.votedUp ? SVG_THUMB_UP : SVG_THUMB_DOWN}
                                </span>
                                <div class="rev-card-meta">
                                    {#if hours != null}<span class="rev-card-hours">{hours.toLocaleString()}h at review</span>{/if}
                                    <span class="rev-card-date">{date}</span>
                                    {#if r.earlyAccess}<span class="rev-card-badge">Early Access</span>{/if}
                                </div>
                                {#if helpful}<span class="rev-card-helpful">{helpful}</span>{/if}
                            </div>
                            <p class="rev-card-text">{r.text ?? ''}</p>
                        </div>
                    {/each}
                </div>
            {:else}
                <p class="game-section-empty">No English reviews cached yet.</p>
            {/if}
        {/if}
    </section>
{/if}
