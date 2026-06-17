<script lang="ts">
    import type { NotesPage } from '../../types.js'
    import { api } from '../../js/api.js'
    import { refreshSidebarItem } from '../../js/sidebar.js'
    import { onMount, onDestroy } from 'svelte'

    let { page: pageProp } = $props()

    let pd      = $state<NotesPage>(JSON.parse(JSON.stringify(pageProp)))
    let mountEl: HTMLElement
    let wall: any = null

    onMount(async () => {
        const { StickyWall } = await import('../../js/vendor/stickywall.js')

        wall = new StickyWall(mountEl, {
            notes:     pd.notes ?? [],
            editable:  true,
            draggable: true,
            tape:      true,
            addForm:   'modal',
        })

        wall
            .on('sw:add',     () => _save())
            .on('sw:update',  () => _save())
            .on('sw:remove',  () => _save())
            .on('sw:reorder', () => _save())
    })

    onDestroy(() => {
        wall?.destroy()
        wall = null
    })

    async function onTitleBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
        const t = (e.currentTarget.textContent ?? '').trim()
        if (!t || t === pd.title) { e.currentTarget.textContent = pd.title; return }
        pd.title = t
        const updated = await api.pages.update(pd.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    }

    async function _save() {
        const notes = wall.serialize()
        pd.notes = notes
        const updated = await api.pages.update(pd.id, { notes })
        if (updated) refreshSidebarItem(updated)
    }
</script>

<div class="page-header">
    <h1 class="page-title page-title--editable" contenteditable="true"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        onblur={onTitleBlur}>{pd.title}</h1>
    <p class="page-subtitle">(Note)</p>
</div>

<div bind:this={mountEl}></div>
