<script lang="ts">
    interface Crumb {
        label: string
        href?: string
    }
    let { crumbs }: { crumbs: Crumb[] } = $props()
</script>

{#if crumbs.length > 0}
<nav class="bc-trail" aria-label="Breadcrumb">
    {#each crumbs as crumb, i}
        {#if i > 0}<span class="bc-sep" aria-hidden="true">›</span>{/if}
        {#if crumb.href}
            <a class="bc-crumb" href={crumb.href}>{crumb.label}</a>
        {:else}
            <span class="bc-crumb bc-crumb--current" aria-current="page">{crumb.label}</span>
        {/if}
    {/each}
</nav>
{/if}
