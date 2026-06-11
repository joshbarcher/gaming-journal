<script>
    import { onMount } from 'svelte'
    import { api } from '../../js/api.js'
    import { navigate } from '../../js/router.js'
    import { confirmDialog } from '../../js/dialog.js'
    import { IC, fmtDate } from '../../js/views/journal-render.js'

    let { appid } = $props()

    let pages   = $state([])
    let loading = $state(true)

    async function load() {
        const res = await api.pages.listByGame(appid).catch(() => [])
        pages = (res ?? []).filter(p => p.type === 'page' || p.type === 'notes')
    }

    async function newPage() {
        const page = await api.pages.create({ type: 'page', title: 'New Page', appid: String(appid) })
        if (page) navigate(page.id)
    }

    async function deletePage(p) {
        const ok = await confirmDialog(
            `Delete "${p.title}"?`,
            'This will permanently delete the page and all its content.',
            'Delete'
        )
        if (!ok) return
        await api.pages.remove(p.id)
        await load()
    }

    onMount(async () => {
        await load()
        loading = false
    })
</script>

{#if loading}
    <p class="page-loading">Loading…</p>
{:else}
<div class="gj-sub-header">
    <a href="/journal/{appid}" class="gj-sub-back">&#8592; Journal</a>
    <span class="gj-sub-title">Journal Pages</span>
    <div class="gj-sub-actions">
        <button class="gj-btn" onclick={newPage}>+ New Page</button>
    </div>
</div>

<div class="gj-full-list">
    {#if pages.length === 0}
        <p class="gj-no-data">No pages yet. Create one to start writing.</p>
    {/if}
    {#each pages as p (p.id)}
        <a class="gj-full-item" href="/{p.id}">
            <span class="gj-full-item-icon">{@html p.type === 'notes' ? IC.notes : IC.file}</span>
            <div class="gj-full-item-body">
                <div class="gj-full-item-title">{p.title}</div>
                <div class="gj-full-item-meta">{p.type === 'notes' ? 'Notes page' : 'Rich page'} · Updated {fmtDate(p.updatedAt)}</div>
            </div>
            <button class="gj-full-item-del" title="Delete page" onclick={(e) => { e.preventDefault(); e.stopPropagation(); deletePage(p) }}>&times;</button>
        </a>
    {/each}
</div>
{/if}
