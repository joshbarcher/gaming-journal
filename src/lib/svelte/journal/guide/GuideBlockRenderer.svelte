<script lang="ts">
    import GuideVideo from './GuideVideo.svelte'

    // List items from the parser: { text: string, children?: { ordered: bool, items: ListItem[] } }
    interface ListItem {
        text: string
        children?: { ordered: boolean; items: ListItem[] }
    }

    // Table cells from buildGrid: { text, html?, image?, colspan?, rowspan? } | null
    // `image` is an image living inside a cell — same shape as an image block, and it
    // resolves through the same localSrc → imgUrl path.
    interface Cell {
        text: string
        html?: string
        image?: { localSrc?: string | null; src?: string; alt?: string }
        colspan?: number
        rowspan?: number
    }

    interface Block {
        type: 'section' | 'heading' | 'paragraph' | 'list' | 'image' | 'video' | 'table'
        level?: number
        heading?: string
        id?: string
        children?: Block[]
        text?: string
        html?: string
        ordered?: boolean
        variant?: 'jumplinks'
        items?: ListItem[]
        src?: string
        localSrc?: string | null
        alt?: string
        caption?: string
        headers?: (Cell | null)[]
        rows?: (Cell | null)[][]
        videoId?: string
        thumb?: { localSrc?: string | null; src?: string }
    }

    let { blocks, steamId, source, guideId, section, onImageClick }: {
        blocks: Block[]
        steamId: string
        source: string
        guideId: string
        section: string
        onImageClick: (url: string) => void
    } = $props()

    function imgUrl(localSrc: string): string {
        const filename = localSrc.replace(/^img\//, '').replace(/\.[^.]+$/, '.webp')
        // `section` can carry a #anchor when navigated via an anchored link; the
        // image lives under the base-slug directory, so drop the fragment.
        const sectionEncoded = encodeURIComponent(section.split('#')[0])
        return `/relay/guides-img/${steamId}/${source}/${guideId}/${sectionEncoded}/img/${filename}`
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

{#snippet cellBody(cell: Cell)}
    {@const imgSrc = cell.image?.localSrc
        ? imgUrl(cell.image.localSrc)
        : (cell.image?.src ?? '')}
    {#if imgSrc}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <img
            class="gv-cell-img"
            src={imgSrc}
            alt={cell.image?.alt ?? ''}
            loading="lazy"
            onclick={() => onImageClick(imgSrc)}
            onkeydown={(e) => e.key === 'Enter' && onImageClick(imgSrc)}
            role="button"
            tabindex="0"
        />
        <!-- Cells can hold both an image and real content (item name, linked location).
             Keep it, but skip when the text is just the image's own alt. -->
        {#if (cell.html ?? cell.text) && cell.text !== cell.image?.alt}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <span class="gv-cell-label">{@html cell.html ?? cell.text}</span>
        {/if}
    {:else}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html cell.html ?? cell.text}
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
                <svelte:self blocks={block.children} {steamId} {source} {guideId} {section} {onImageClick} />
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

    {:else if block.type === 'list' && block.variant === 'jumplinks'}
        <!-- One DOM element, like every other block — guide-blocks-search maps
             block index to child index and would misresolve a fragment here. -->
        <nav class="gv-jumplinks">
            {#each block.items ?? [] as item}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html item.text}
            {/each}
        </nav>

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

    {:else if block.type === 'video' && block.videoId}
        <!-- One DOM element per block, like every other branch — guide-blocks-search maps
             a block index to a child index and would misresolve a fragment here. -->
        <GuideVideo
            videoId={block.videoId}
            thumbUrl={block.thumb?.localSrc ? imgUrl(block.thumb.localSrc) : ''}
            caption={block.caption ?? ''}
        />

    {:else if block.type === 'table'}
        <div class="gv-table-outer"><div class="gv-table-wrap">
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
                                        {@render cellBody(h)}
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
                                        {@render cellBody(cell)}
                                    </td>
                                {/if}
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div></div>
    {/if}
{/each}
