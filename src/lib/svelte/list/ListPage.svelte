<script lang="ts">
    import type { ListPage as ListPageType, JournalListItem } from '../../types.js'
    import { api } from '../../js/api.js'
    import { uuid } from '../../js/utils.js'
    import { refreshSidebarItem } from '../../js/sidebar.js'

    let { page: initialPage } = $props()

    let page = $state<ListPageType>({
        ...initialPage,
        items: initialPage.items.map((i: JournalListItem) => ({ ...i, subtasks: [...(i.subtasks ?? [])] })),
    })

    let listEl              = $state<HTMLElement | null>(null)
    let addingSubtaskItemId = $state<string | null>(null)
    let subtaskValue        = $state('')
    let pendingFocusItemId  = $state<string | null>(null)

    // Drag state (non-reactive)
    let _itemDragId: string | null = null
    let _chipDragSrc: { node: HTMLElement; itemId: string; text: string } | null = null

    let sorted = $derived([...page.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))

    // ── Focus newly added item ─────────────────────────────────────────────────

    $effect(() => {
        if (!pendingFocusItemId || !listEl) return
        const el = listEl.querySelector<HTMLElement>(`.list-item[data-id="${pendingFocusItemId}"] .list-item-title`)
        if (!el) return
        el.focus()
        pendingFocusItemId = null
    })

    // ── Save ───────────────────────────────────────────────────────────────────

    async function save() {
        try {
            await api.pages.update(page.id, { items: page.items, ordered: page.ordered })
            refreshSidebarItem({ ...page })
        } catch (err) { console.error('Failed to save list', err) }
    }

    // ── Title ──────────────────────────────────────────────────────────────────

    async function onTitleBlur(e: Event) {
        const target = e.target as HTMLElement
        const t = target.textContent?.trim() ?? ''
        if (!t || t === page.title) { target.textContent = page.title; return }
        page.title = t
        const updated = await api.pages.update(page.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    }

    async function toggleOrdered() {
        page.ordered = !page.ordered
        await save()
    }

    // ── Item actions ───────────────────────────────────────────────────────────

    async function addItem() {
        const newItem = { id: uuid(), title: '', subtasks: [], order: page.items.length }
        page.items = [...page.items, newItem]
        pendingFocusItemId = newItem.id
        await save()
    }

    async function deleteItem(itemId: string) {
        page.items = page.items.filter((i: JournalListItem) => i.id !== itemId).map((item, i) => ({ ...item, order: i }))
        await save()
    }

    async function toggleDone(itemId: string) {
        const item = page.items.find((i: JournalListItem) => i.id === itemId)
        if (!item) return
        item.done = !item.done
        await save()
    }

    async function saveItemTitle(itemId: string, e: Event) {
        const item = page.items.find((i: JournalListItem) => i.id === itemId)
        if (!item) return
        const newTitle = (e.target as HTMLElement).textContent?.trim() ?? ''
        if (item.title === newTitle) return
        item.title = newTitle
        await save()
    }

    // ── Subtask actions ────────────────────────────────────────────────────────

    function focusEl(node: HTMLElement) { node.focus() }

    async function commitSubtask(itemId: string) {
        const val = subtaskValue.trim()
        if (!val) return
        const item = page.items.find((i: JournalListItem) => i.id === itemId)
        if (!item || (item.subtasks ?? []).includes(val)) return
        item.subtasks = [...(item.subtasks ?? []), val]
        subtaskValue = ''
        await save()
    }

    async function subtaskKeydown(itemId: string, e: KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault()
            await commitSubtask(itemId)
        }
        if (e.key === 'Escape') addingSubtaskItemId = null
    }

    async function subtaskBlur(itemId: string) {
        await commitSubtask(itemId)
        addingSubtaskItemId = null
    }

    async function removeSubtask(itemId: string, text: string) {
        const item = page.items.find((i: JournalListItem) => i.id === itemId)
        if (!item) return
        item.subtasks = (item.subtasks ?? []).filter((s: string) => s !== text)
        await save()
    }

    // ── Chip drag action ───────────────────────────────────────────────────────

    function chipDrag(node: HTMLElement, { itemId, text }: { itemId: string; text: string }) {
        node.draggable = true
        function onDragstart(e: DragEvent) {
            e.stopPropagation()
            _chipDragSrc = { node, itemId, text }
            node.classList.add('subtask-chip--dragging')
            e.dataTransfer!.effectAllowed = 'move'
        }
        function onDragend() {
            node.classList.remove('subtask-chip--dragging')
            node.parentElement?.querySelectorAll('.subtask-chip--drag-over')
                .forEach(x => x.classList.remove('subtask-chip--drag-over'))
            const src = _chipDragSrc
            _chipDragSrc = null
            if (src) persistChipOrder(src.itemId, src.node.parentElement)
        }
        function onDragover(e: DragEvent) {
            if (!_chipDragSrc || _chipDragSrc.node === node) return
            e.preventDefault(); e.stopPropagation()
            node.parentElement?.querySelectorAll('.subtask-chip--drag-over')
                .forEach(x => x.classList.remove('subtask-chip--drag-over'))
            node.classList.add('subtask-chip--drag-over')
        }
        function onDragleave() { node.classList.remove('subtask-chip--drag-over') }
        function onDrop(e: DragEvent) {
            if (!_chipDragSrc || _chipDragSrc.node === node) return
            e.preventDefault(); e.stopPropagation()
            node.classList.remove('subtask-chip--drag-over')
            if (_chipDragSrc.node.parentElement !== node.parentElement) return
            const chips = [...node.parentElement!.querySelectorAll('.subtask-chip')]
            if (chips.indexOf(_chipDragSrc.node) < chips.indexOf(node)) node.after(_chipDragSrc.node)
            else node.before(_chipDragSrc.node)
        }
        node.addEventListener('dragstart', onDragstart)
        node.addEventListener('dragend',   onDragend)
        node.addEventListener('dragover',  onDragover)
        node.addEventListener('dragleave', onDragleave)
        node.addEventListener('drop',      onDrop)
        return { destroy() {
            node.removeEventListener('dragstart', onDragstart)
            node.removeEventListener('dragend',   onDragend)
            node.removeEventListener('dragover',  onDragover)
            node.removeEventListener('dragleave', onDragleave)
            node.removeEventListener('drop',      onDrop)
        }}
    }

    async function persistChipOrder(itemId: string, containerEl: Element | null) {
        if (!containerEl) return
        const item = page.items.find((i: JournalListItem) => i.id === itemId)
        if (!item) return
        item.subtasks = [...containerEl.querySelectorAll('.subtask-chip')]
            .map(c => c.querySelector('span')?.textContent ?? '').filter(Boolean)
        await save()
    }

    // ── Item drag (event delegation on list container) ─────────────────────────

    function onListDragstart(e: DragEvent) {
        if (_chipDragSrc) return
        const row = (e.target as Element)?.closest<HTMLElement>('.list-item')
        if (!row) return
        _itemDragId = row.dataset.id ?? null
        row.classList.add('dragging')
        e.dataTransfer!.effectAllowed = 'move'
    }

    function onListDragend(e: DragEvent) {
        const row = (e.target as Element)?.closest<HTMLElement>('.list-item')
        if (row) { row.draggable = false; row.classList.remove('dragging') }
        listEl?.querySelectorAll('.list-item.drag-over').forEach(el => el.classList.remove('drag-over'))
        _itemDragId = null
    }

    function onListDragover(e: DragEvent) {
        e.preventDefault()
        const target = (e.target as Element)?.closest<HTMLElement>('.list-item')
        if (!target) return
        listEl?.querySelectorAll('.list-item.drag-over').forEach(el => el.classList.remove('drag-over'))
        if (_chipDragSrc && _chipDragSrc.itemId !== target.dataset.id) {
            target.classList.add('drag-over')
        } else if (_itemDragId && target.dataset.id !== _itemDragId) {
            target.classList.add('drag-over')
        }
    }

    async function onListDrop(e: DragEvent) {
        e.preventDefault()
        const target = (e.target as Element)?.closest<HTMLElement>('.list-item')
        if (!target) return
        listEl?.querySelectorAll('.list-item.drag-over').forEach(el => el.classList.remove('drag-over'))

        // Cross-item chip move
        if (_chipDragSrc && _chipDragSrc.itemId !== target.dataset.id) {
            const src    = page.items.find((i: JournalListItem) => i.id === _chipDragSrc!.itemId)
            const tgt    = page.items.find((i: JournalListItem) => i.id === target.dataset.id)
            const text   = _chipDragSrc!.text
            if (src && tgt) {
                src.subtasks = (src.subtasks ?? []).filter((s: string) => s !== text)
                if (!(tgt.subtasks ?? []).includes(text)) tgt.subtasks = [...(tgt.subtasks ?? []), text]
                const tgtRow = target.querySelector('.list-subtasks')
                const addBtn = tgtRow?.querySelector('.subtask-add-btn, .subtask-input')
                if (tgtRow) tgtRow.insertBefore(_chipDragSrc!.node, addBtn ?? null)
            }
            _chipDragSrc = null
            await save()
            return
        }

        // Item reorder
        if (!_itemDragId || target.dataset.id === _itemDragId) return
        const rows    = [...listEl!.querySelectorAll<HTMLElement>('.list-item')]
        const fromIdx = rows.findIndex(el => el.dataset.id === _itemDragId)
        const toIdx   = rows.findIndex(el => el === target)
        if (fromIdx === -1 || toIdx === -1) return

        if (fromIdx < toIdx) target.after(rows[fromIdx])
        else target.before(rows[fromIdx])

        const newIds = [...listEl!.querySelectorAll<HTMLElement>('.list-item')].map(el => el.dataset.id)
        const map    = new Map(page.items.map((i: JournalListItem) => [i.id, i]))
        page.items   = newIds.map(id => map.get(id!)).filter((i): i is JournalListItem => !!i).map((item, idx) => ({ ...item, order: idx }))
        await save()
    }
</script>

<div class="page-header">
    <h1
        class="page-title page-title--editable"
        contenteditable="true"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur() } }}
        onblur={onTitleBlur}
    >{page.title}</h1>
    <div class="list-type-row">
        <button class="list-type-toggle" onclick={toggleOrdered}>
            {page.ordered ? '# Ordered' : '• Unordered'}
        </button>
    </div>
</div>

<div
    class="list-items"
    bind:this={listEl}
    ondragstart={onListDragstart}
    ondragend={onListDragend}
    ondragover={onListDragover}
    ondrop={onListDrop}
>
    {#each sorted as item (item.id)}
        <div class="list-item" class:list-item--done={item.done} data-id={item.id}>
            <div class="list-item-main">
                <span
                    class="list-item-handle"
                    title="Drag to reorder"
                    onmousedown={(e) => { const li = (e.currentTarget as HTMLElement).closest<HTMLElement>('.list-item'); if (li) li.draggable = true }}
                >⠿</span>
                {#if page.ordered}
                    <span class="list-item-num">{sorted.indexOf(item) + 1}</span>
                {:else}
                    <span class="list-item-bullet"></span>
                {/if}
                <span
                    class="list-item-title"
                    contenteditable="true"
                    spellcheck="false"
                    onkeydown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            ;(e.target as HTMLElement).blur()
                            addingSubtaskItemId = item.id
                            subtaskValue = ''
                        }
                        if (e.key === 'Escape') { (e.target as HTMLElement).textContent = item.title; (e.target as HTMLElement).blur() }
                    }}
                    onblur={(e) => saveItemTitle(item.id, e)}
                >{item.title}</span>
                <button
                    class="list-item-done-btn"
                    class:done={item.done}
                    title={item.done ? 'Mark incomplete' : 'Mark complete'}
                    onclick={(e) => { e.stopPropagation(); toggleDone(item.id) }}
                >&#10003;</button>
                <button class="list-item-delete" onclick={() => deleteItem(item.id)}>&times;</button>
            </div>
            <div class="list-subtasks">
                {#each item.subtasks as sub (sub)}
                    <span class="subtask-chip" use:chipDrag={{ itemId: item.id, text: sub }}>
                        <span>{sub}</span>
                        <button class="subtask-chip-remove" onclick={() => removeSubtask(item.id, sub)}>&times;</button>
                    </span>
                {/each}
                {#if addingSubtaskItemId === item.id}
                    <input
                        class="subtask-input"
                        type="text"
                        placeholder="Subtask name…"
                        maxlength="80"
                        bind:value={subtaskValue}
                        use:focusEl
                        onkeydown={(e) => subtaskKeydown(item.id, e)}
                        onblur={() => subtaskBlur(item.id)}
                    >
                {:else}
                    <button class="subtask-add-btn" onclick={() => { addingSubtaskItemId = item.id; subtaskValue = '' }}>+ subtask</button>
                {/if}
            </div>
        </div>
    {/each}
</div>

<button class="list-add-btn" onclick={addItem}>+ Add Item</button>
