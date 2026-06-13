<script lang="ts">
    import { groupPagesByType } from '../../js/utils.js'

    let { pages } = $props()

    let groups = $derived(groupPagesByType(pages))
</script>

<div class="page-header">
    <h1 class="page-title">Table of Contents</h1>
    <p class="page-subtitle">(Quicklinks)</p>
</div>

{#if groups.length === 0}
    <p class="toc-empty">No pages yet — use "+ New Page" to get started.</p>
{:else}
    <div class="toc-body">
        {#each groups as group}
            <div class="toc-section">
                <h2 class="toc-section-title">{group.label}</h2>
                <ul class="toc-list">
                    {#each group.pages as page}
                        <li><a class="toc-link" href="/{page.id}">{page.title}</a></li>
                    {/each}
                </ul>
            </div>
        {/each}
    </div>
{/if}
