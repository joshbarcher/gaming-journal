<script lang="ts">
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
        <span class="gj-star-legendary">✦ Legendary</span>
    {/if}
{/if}
