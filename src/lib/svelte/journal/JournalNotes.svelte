<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { api } from '../../js/api.js'
    import Breadcrumb from '../Breadcrumb.svelte'

    let { appid, gameName = '' } = $props()

    let mountEl: HTMLElement
    let wall: any = null
    let noteCount = $state(0)

    function openAdd() {
        mountEl?.querySelector<HTMLButtonElement>('.sw-add__toggle')?.click()
    }

    onMount(async () => {
        const [{ StickyWall }, notes] = await Promise.all([
            import('../../js/vendor/stickywall.js'),
            api.journalNotes.get(appid).catch(() => []),
        ])

        noteCount = Array.isArray(notes) ? notes.length : 0

        wall = new StickyWall(mountEl, {
            notes,
            editable:  true,
            draggable: true,
            tape:      true,
            addForm:   'modal',
        })

        wall
            .on('sw:add',     () => { _save(); noteCount = wall.serialize().length })
            .on('sw:update',  () => _save())
            .on('sw:remove',  () => { _save(); noteCount = wall.serialize().length })
            .on('sw:reorder', () => _save())
    })

    onDestroy(() => {
        wall?.destroy()
        wall = null
    })

    async function _save() {
        await api.journalNotes.set(appid, wall.serialize())
    }
</script>

<div class="gj-sub-header">
    <Breadcrumb crumbs={[
        { label: 'Home', href: '/' },
        { label: gameName || '…', href: `/game/${appid}` },
        { label: 'Journal', href: `/journal/${appid}` },
        { label: 'Notes' },
    ]} />
    <div class="gj-sub-actions">
        <button class="gj-btn gj-btn--accent gj-notes-add-btn" onclick={openAdd}>
            + Add Note
            {#if noteCount > 0}<span class="gj-notes-count">{noteCount}</span>{/if}
        </button>
    </div>
</div>

<div class="gj-notes-wall-wrap">
    <div bind:this={mountEl}></div>
</div>

<style>
    /* suppress StickyWall's own add button — ours lives in the header */
    :global(.gj-notes-wall-wrap .sw-add) {
        display: none;
    }

    .gj-notes-add-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

    .gj-notes-count {
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        background: rgba(201, 168, 76, 0.2);
        border-radius: 999px;
        padding: 2px 6px;
    }
</style>
