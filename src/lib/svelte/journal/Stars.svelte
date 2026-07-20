<script lang="ts">
    import Icon from '../Icon.svelte'
    interface Props { stars?: number | null }
    let { stars }: Props = $props()
</script>

{#if stars != null && stars !== 0}
    {#each { length: 5 } as _, i}
        <span class="gj-star" class:gj-star--on={i < (stars === 6 ? 5 : stars)}>
            {i < (stars === 6 ? 5 : stars) ? '★' : '☆'}
        </span>
    {/each}
    {#if stars === 6}
        <span class="gj-star-legendary"><Icon name="sparkles" tone="gold" size={12} /> Legendary</span>
    {/if}
{/if}
