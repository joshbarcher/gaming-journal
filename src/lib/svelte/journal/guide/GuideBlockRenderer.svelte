<script lang="ts">
    interface Block {
        type: 'section' | 'heading' | 'paragraph' | 'list' | 'image' | 'table'
        level?: number
        heading?: string
        id?: string
        children?: Block[]
        text?: string
        html?: string
        ordered?: boolean
        items?: string[]
        src?: string
        localSrc?: string | null
        alt?: string
        caption?: string
        headers?: string[]
        rows?: string[][]
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

{#each blocks as block}
    {#if block.type === 'section'}
        {@const tag = block.level === 2 ? 'h2' : block.level === 3 ? 'h3' : 'h4'}
        <div class="gv-section gv-section--h{block.level}" id={block.id}>
            {#if tag === 'h2'}
                <h2 class="gv-h2" id={block.id}>{block.heading}</h2>
            {:else if tag === 'h3'}
                <h3 class="gv-h3" id={block.id}>{block.heading}</h3>
            {:else}
                <h4 class="gv-h4" id={block.id}>{block.heading}</h4>
            {/if}
            {#if block.children?.length}
                <svelte:self blocks={block.children} {steamId} {source} {section} {onImageClick} />
            {/if}
        </div>
    {:else if block.type === 'heading'}
        {#if block.level === 1}
            <h1 class="gv-h1">{block.text}</h1>
        {:else if block.level === 2}
            <h2 class="gv-h2" >{block.text}</h2>
        {:else if block.level === 3}
            <h3 class="gv-h3">{block.text}</h3>
        {:else}
            <h4 class="gv-h4">{block.text}</h4>
        {/if}
    {:else if block.type === 'paragraph'}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <p class="gv-p">{@html block.html}</p>
    {:else if block.type === 'list'}
        {#if block.ordered}
            <ol class="gv-list">
                {#each block.items ?? [] as item}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <li>{@html item}</li>
                {/each}
            </ol>
        {:else}
            <ul class="gv-list">
                {#each block.items ?? [] as item}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <li>{@html item}</li>
                {/each}
            </ul>
        {/if}
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
                                <th>{@html h}</th>
                            {/each}
                        </tr>
                    </thead>
                {/if}
                <tbody>
                    {#each block.rows ?? [] as row}
                        <tr>
                            {#each row as cell}
                                <td>{@html cell}</td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
{/each}
