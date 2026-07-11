<script lang="ts">
    import type { NexusBlock, NexusListItem } from '../../types.js'
    let { blocks }: { blocks: NexusBlock[] } = $props()
</script>

{#snippet list(items: NexusListItem[], ordered: boolean)}
    {#if ordered}
        <ol class="nxd-list">
            {#each items as item}
                <li>{@html item.text}{#if item.children?.items?.length}{@render list(item.children.items, item.children.ordered)}{/if}</li>
            {/each}
        </ol>
    {:else}
        <ul class="nxd-list">
            {#each items as item}
                <li>{@html item.text}{#if item.children?.items?.length}{@render list(item.children.items, item.children.ordered)}{/if}</li>
            {/each}
        </ul>
    {/if}
{/snippet}

{#each blocks as block}
    {#if block.type === 'heading'}
        {#if block.level === 2}
            <h2 class="nxd-h2">{block.text}</h2>
        {:else if block.level === 3}
            <h3 class="nxd-h3">{block.text}</h3>
        {:else}
            <h4 class="nxd-h4">{block.text}</h4>
        {/if}
    {:else if block.type === 'paragraph'}
        <p class="nxd-p">{@html block.html}</p>
    {:else if block.type === 'list'}
        {@render list(block.items ?? [], block.ordered ?? false)}
    {:else if block.type === 'image' && block.src}
        <figure class="nxd-fig">
            <img src={block.src} alt={block.alt ?? ''} loading="lazy" />
            {#if block.caption}<figcaption>{block.caption}</figcaption>{/if}
        </figure>
    {/if}
{/each}
