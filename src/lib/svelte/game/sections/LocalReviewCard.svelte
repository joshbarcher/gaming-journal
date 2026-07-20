<script lang="ts">
    import type { LocalReview } from '../../../types.js'
    import { SLIDER_KEYS, BADGES } from '../../../js/review-modal.js'
    import Icon from '../../Icon.svelte'

    interface Props { review: LocalReview }
    let { review }: Props = $props()

    let isLegendary   = $derived(review.stars === 6)
    let displayStars  = $derived(isLegendary ? 5 : review.stars)
    let ratings       = $derived(review.ratings ?? {})
    let activeBars    = $derived(SLIDER_KEYS.filter(({ key }) => (ratings[key] ?? 0) > 0))
    let activeBadges  = $derived(BADGES.filter(b => review.badges?.[b.id]))
    let hasColumns    = $derived(!!(activeBars.length || review.tags?.length || activeBadges.length))

    let textExpanded = $state(false)
</script>

<div class="rev-local-card">
    <div class="rev-local-header">
        <div class="rev-local-stars">
            {#each { length: 5 } as _, i}
                <span class="rev-local-star" class:rev-local-star--active={i < displayStars}>
                    {i < displayStars ? '★' : '☆'}
                </span>
            {/each}
            {#if isLegendary}<span class="rev-legendary-badge"><Icon name="sparkles" color="#1a1208" size={12} />Legendary</span>{/if}
        </div>
    </div>

    {#if hasColumns}
        <div class="rev-local-body">
            <div class="rev-local-left">
                <div class="rev-bars">
                    {#each activeBars as { key, label }}
                        {@const val = ratings[key] as number}
                        <div class="rev-bar-labeled">
                            <div class="rev-bar-fill" style="width:{(val / 10) * 100}%"></div>
                            <span class="rev-bar-lbl">{label}</span>
                            <span class="rev-bar-val">{val}</span>
                        </div>
                    {/each}
                </div>
            </div>
            <div class="rev-local-right">
                {#if review.tags?.length}
                    <div class="rev-tags-row">
                        {#each review.tags as t}
                            <span class="rev-tag-pill">{t}</span>
                        {/each}
                    </div>
                {/if}
                {#if activeBadges.length}
                    <div class="rev-badges-row">
                        {#each activeBadges as b}
                            {@const val = review.badges![b.id]}
                            <div class="rev-badge" style="--badge-clr:{b.color}">
                                <div class="rev-badge-circle">
                                    {#if b.hasCount && (val as number) > 1}
                                        <span class="rev-badge-num">×{val}</span>
                                    {:else}
                                        {@html b.icon}
                                    {/if}
                                </div>
                                <span class="rev-badge-label">{b.label}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    {#if review.review}
        <div class="rev-review-wrap" class:rev-review-wrap--expanded={textExpanded}>
            <p class="rev-review-text">{review.review}</p>
            <button class="rev-review-toggle" onclick={() => textExpanded = !textExpanded}>
                {textExpanded ? 'Show less ↑' : 'Read review ↓'}
            </button>
        </div>
    {/if}
</div>
