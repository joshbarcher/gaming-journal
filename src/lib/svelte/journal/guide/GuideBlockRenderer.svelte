<script lang="ts">
    // List items from the parser: { text: string, children?: { ordered: bool, items: ListItem[] } }
    interface ListItem {
        text: string
        children?: { ordered: boolean; items: ListItem[] }
    }

    // Table cells from buildGrid: { text: string, colspan?: number, rowspan?: number } | null
    interface Cell {
        text: string
        colspan?: number
        rowspan?: number
    }

    interface Block {
        type: 'section' | 'heading' | 'paragraph' | 'list' | 'image' | 'table'
        level?: number
        heading?: string
        id?: string
        children?: Block[]
        text?: string
        html?: string
        ordered?: boolean
        items?: ListItem[]
        src?: string
        localSrc?: string | null
        alt?: string
        caption?: string
        headers?: (Cell | null)[]
        rows?: (Cell | null)[][]
    }

    let { blocks, steamId, source, section, onImageClick }: {
        blocks: Block[]
        steamId: string
        source: string
        section: string
        onImageClick: (url: string) => void
    } = $props()

    function imgUrl(localSrc: string): string {
        const filename = localSrc.replace(/^img\//, '')
        const sectionEncoded = encodeURIComponent(section)
        return `/relay/guides-img/${steamId}/${source}/${sectionEncoded}/img/${filename}`
    }
</script>

{#snippet listItems(items: ListItem[], ordered: boolean)}
    {#if ordered}
        <ol class="gv-list">
            {#each items as item}
                <li>
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html item.text}
                    {#if item.children?.items?.length}
                        {@render listItems(item.children.items, item.children.ordered)}
                    {/if}
                </li>
            {/each}
        </ol>
    {:else}
        <ul class="gv-list">
            {#each items as item}
                <li>
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html item.text}
                    {#if item.children?.items?.length}
                        {@render listItems(item.children.items, item.children.ordered)}
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
{/snippet}

{#each blocks as block}
    {#if block.type === 'section'}
        <div class="gv-section gv-section--h{block.level}" id={block.id}>
            {#if block.level === 2}
                <h2 class="gv-h2" id={block.id}>{block.heading}</h2>
            {:else if block.level === 3}
                <h3 class="gv-h3" id={block.id}>{block.heading}</h3>
            {:else}
                <h4 class="gv-h4" id={block.id}>{block.heading}</h4>
            {/if}
            {#if block.children?.length}
                <svelte:self blocks={block.children} {steamId} {source} {section} {onImageClick} />
            {/if}
        </div>

    {:else if block.type === 'heading' && block.level !== 1}
        {#if block.level === 2}
            <h2 class="gv-h2">{block.text}</h2>
        {:else if block.level === 3}
            <h3 class="gv-h3">{block.text}</h3>
        {:else}
            <h4 class="gv-h4">{block.text}</h4>
        {/if}

    {:else if block.type === 'paragraph'}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <p class="gv-p">{@html block.html}</p>

    {:else if block.type === 'list'}
        {@render listItems(block.items ?? [], block.ordered ?? false)}

    {:else if block.type === 'image'}
        {@const url = block.localSrc ? imgUrl(block.localSrc) : (block.src ?? '')}
        {#if url}
            <figure class="gv-figure">
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <img
                    class="gv-img"
                    src={url}
                    alt={block.alt ?? ''}
                    onclick={() => onImageClick(url)}
                    onkeydown={(e) => e.key === 'Enter' && onImageClick(url)}
                    role="button"
                    tabindex="0"
                />
                {#if block.caption}
                    <figcaption class="gv-caption">{block.caption}</figcaption>
                {/if}
            </figure>
        {/if}

    {:else if block.type === 'table'}
        <div class="gv-table-wrap">
            <table class="gv-table">
                {#if block.caption}
                    <caption class="gv-table-caption">{block.caption}</caption>
                {/if}
                {#if block.headers?.length}
                    <thead>
                        <tr>
                            {#each block.headers as h}
                                {#if h}
                                    <th colspan={h.colspan ?? 1} rowspan={h.rowspan ?? 1}>
                                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                                        {@html h.text}
                                    </th>
                                {/if}
                            {/each}
                        </tr>
                    </thead>
                {/if}
                <tbody>
                    {#each block.rows ?? [] as row}
                        <tr>
                            {#each row as cell}
                                {#if cell}
                                    <td colspan={cell.colspan ?? 1} rowspan={cell.rowspan ?? 1}>
                                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                                        {@html cell.text}
                                    </td>
                                {/if}
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
{/each}
