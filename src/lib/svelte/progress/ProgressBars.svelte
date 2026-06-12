<script>
    import { onDestroy } from 'svelte'
    import { api } from '../../js/api.js'
    import { uuid } from '../../js/utils.js'
    import { refreshSidebarItem } from '../../js/sidebar.js'
    import { segmentColor, barProgressPercent, globalSegments, stateLabel } from '../../js/views/progress-helpers.js'
    import { fireParticles } from '../../js/particles.js'
    import { showContextMenu } from '../../js/views/context-menu.js'
    import { navigate } from '../../js/router.js'

    let { page: initialPage } = $props()

    const STATE_CYCLE = [null, 'started', 'working', 'done']

    let page = $state(JSON.parse(JSON.stringify(initialPage)))
    let barsListEl = $state(null)
    let pendingFocusStepId = $state(null)
    let _notesTimer = null

    // Module-level drag refs (not reactive — just identity tracking)
    let _dragBarSrc  = null
    let _dragChipSrc = null

    // ── Derived ────────────────────────────────────────────────────────────────

    let segs = $derived(globalSegments(page))

    function barRowClass(bar) {
        const pct = barProgressPercent(bar)
        if (bar.optional) return pct >= 100 ? 'pb-bar-row pb-bar-row--optional-done' : 'pb-bar-row pb-bar-row--optional'
        return 'pb-bar-row'
    }

    function chipStyle(step) {
        return step.state
            ? `background:${segmentColor(step.state)};color:rgba(0,0,0,0.75)`
            : 'background:rgba(255,255,255,0.07);color:var(--clr-text-muted)'
    }

    // ── Focus new step after add ────────────────────────────────────────────────

    $effect(() => {
        if (!pendingFocusStepId || !barsListEl) return
        const label = barsListEl.querySelector(`.pb-chip[data-step-id="${pendingFocusStepId}"] .pb-chip-label`)
        if (!label) return
        label.contentEditable = 'true'
        label.focus()
        const range = document.createRange()
        range.selectNodeContents(label)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        pendingFocusStepId = null
    })

    // ── Save ───────────────────────────────────────────────────────────────────

    async function save() {
        const updated = await api.pages.update(page.id, { bars: page.bars, notes: page.notes })
        if (updated) refreshSidebarItem(updated)
    }

    // ── Title ──────────────────────────────────────────────────────────────────

    async function onTitleBlur(e) {
        const t = e.target.textContent.trim()
        if (!t || t === page.title) { e.target.textContent = page.title; return }
        page.title = t
        const updated = await api.pages.update(page.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    }

    // ── Notes ──────────────────────────────────────────────────────────────────

    function onNotesInput(e) {
        page.notes = e.target.value
        clearTimeout(_notesTimer)
        _notesTimer = setTimeout(save, 800)
    }

    // ── Bar actions ────────────────────────────────────────────────────────────

    async function addBar() {
        const bar = { id: uuid(), title: '', steps: [] }
        page.bars = [...(page.bars ?? []), bar]
        await save()
    }

    async function deleteBar(barId) {
        page.bars = (page.bars ?? []).filter(b => b.id !== barId)
        await save()
    }

    async function copyBar(sourceBarId) {
        const source = (page.bars ?? []).find(b => b.id === sourceBarId)
        if (!source) return
        const newBar = {
            id: uuid(),
            title: source.title,
            optional: source.optional,
            steps: (source.steps ?? []).map(s => ({ id: uuid(), title: s.title, optional: s.optional, state: null })),
        }
        const srcIdx = page.bars.findIndex(b => b.id === sourceBarId)
        page.bars = [...page.bars.slice(0, srcIdx + 1), newBar, ...page.bars.slice(srcIdx + 1)]
        await save()
    }

    async function toggleBarOptional(barId) {
        const bar = (page.bars ?? []).find(b => b.id === barId)
        if (!bar) return
        bar.optional = !bar.optional
        await save()
    }

    async function onBarTitleBlur(barId, e) {
        const bar = (page.bars ?? []).find(b => b.id === barId)
        if (!bar) return
        const newTitle = e.target.textContent.trim()
        if (bar.title === newTitle) return
        bar.title = newTitle
        await save()
    }

    // ── Step actions ───────────────────────────────────────────────────────────

    async function addStep(barId) {
        const bar = (page.bars ?? []).find(b => b.id === barId)
        if (!bar) return
        const step = { id: uuid(), title: '', state: null }
        bar.steps = [...(bar.steps ?? []), step]
        pendingFocusStepId = step.id
        await save()
    }

    async function deleteStep(barId, stepId) {
        const bar = (page.bars ?? []).find(b => b.id === barId)
        if (!bar) return
        bar.steps = (bar.steps ?? []).filter(s => s.id !== stepId)
        await save()
    }

    async function toggleStepOptional(barId, stepId) {
        const bar = (page.bars ?? []).find(b => b.id === barId)
        if (!bar) return
        const step = (bar.steps ?? []).find(s => s.id === stepId)
        if (!step) return
        step.optional = !step.optional
        await save()
    }

    async function cycleStepState(barId, stepId, chipEl) {
        const bar = (page.bars ?? []).find(b => b.id === barId)
        if (!bar) return
        const step = (bar.steps ?? []).find(s => s.id === stepId)
        if (!step) return
        const prev = step.state
        const idx  = STATE_CYCLE.indexOf(step.state)
        step.state = STATE_CYCLE[(idx + 1) % STATE_CYCLE.length]
        if (step.state === 'done' && prev !== 'done') {
            const required = (bar.steps ?? []).filter(s => !s.optional)
            if (required.length > 0 && required.every(s => s.state === 'done')) {
                fireParticles(chipEl, bar.title)
            }
        }
        await save()
    }

    async function onStepTitleBlur(barId, stepId, e) {
        const bar = (page.bars ?? []).find(b => b.id === barId)
        if (!bar) return
        const step = (bar.steps ?? []).find(s => s.id === stepId)
        if (!step) return
        const newTitle = e.target.textContent.trim()
        if (step.title === newTitle) return
        step.title = newTitle
        await save()
    }

    // ── Bar drag action ────────────────────────────────────────────────────────

    function barDrag(node, barId) {
        const handle = node.querySelector('.pb-bar-handle')
        handle?.addEventListener('mousedown', () => { node.draggable = true })

        function onDragstart(e) {
            _dragBarSrc = node
            node.classList.add('pb-bar-row--dragging')
            e.dataTransfer.effectAllowed = 'move'
        }
        function onDragend() {
            node.draggable = false
            node.classList.remove('pb-bar-row--dragging')
            barsListEl?.querySelectorAll('.pb-bar-row--drag-over').forEach(x => x.classList.remove('pb-bar-row--drag-over'))
            _dragBarSrc = null
            persistBarOrder()
        }
        function onDragover(e) {
            if (!_dragBarSrc || _dragBarSrc === node || _dragChipSrc) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            barsListEl?.querySelectorAll('.pb-bar-row--drag-over').forEach(x => x.classList.remove('pb-bar-row--drag-over'))
            node.classList.add('pb-bar-row--drag-over')
        }
        function onDragleave(e) {
            if (!node.contains(e.relatedTarget)) node.classList.remove('pb-bar-row--drag-over')
        }
        function onDrop(e) {
            if (!_dragBarSrc || _dragBarSrc === node || _dragChipSrc) return
            e.preventDefault()
            node.classList.remove('pb-bar-row--drag-over')
            const rows = [...(barsListEl?.querySelectorAll('.pb-bar-row') ?? [])]
            if (rows.indexOf(_dragBarSrc) < rows.indexOf(node)) node.after(_dragBarSrc)
            else node.before(_dragBarSrc)
        }

        node.addEventListener('dragstart', onDragstart)
        node.addEventListener('dragend',   onDragend)
        node.addEventListener('dragover',  onDragover)
        node.addEventListener('dragleave', onDragleave)
        node.addEventListener('drop',      onDrop)
        return {
            destroy() {
                node.removeEventListener('dragstart', onDragstart)
                node.removeEventListener('dragend',   onDragend)
                node.removeEventListener('dragover',  onDragover)
                node.removeEventListener('dragleave', onDragleave)
                node.removeEventListener('drop',      onDrop)
            }
        }
    }

    async function persistBarOrder() {
        if (!barsListEl) return
        const ids = [...barsListEl.querySelectorAll('.pb-bar-row')].map(r => r.dataset.barId)
        const map = new Map((page.bars ?? []).map(b => [b.id, b]))
        page.bars = ids.map(id => map.get(id)).filter(Boolean)
        await save()
    }

    // ── Chip drag action ───────────────────────────────────────────────────────

    function chipDrag(node, { barId }) {
        node.draggable = true

        function onDragstart(e) {
            e.stopPropagation()
            _dragChipSrc = node
            node.classList.add('pb-chip--dragging')
            e.dataTransfer.effectAllowed = 'move'
        }
        function onDragend() {
            node.classList.remove('pb-chip--dragging')
            document.querySelectorAll('.pb-chip--drag-over').forEach(x => x.classList.remove('pb-chip--drag-over'))
            _dragChipSrc = null
            persistChipOrder(barId)
        }
        function onDragover(e) {
            if (!_dragChipSrc || _dragChipSrc === node) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            document.querySelectorAll('.pb-chip--drag-over').forEach(x => x.classList.remove('pb-chip--drag-over'))
            node.classList.add('pb-chip--drag-over')
        }
        function onDragleave() { node.classList.remove('pb-chip--drag-over') }
        function onDrop(e) {
            if (!_dragChipSrc || _dragChipSrc === node) return
            e.preventDefault()
            e.stopPropagation()
            node.classList.remove('pb-chip--drag-over')
            if (_dragChipSrc.parentElement !== node.parentElement) return
            const chips = [...node.parentElement.querySelectorAll('.pb-chip')]
            if (chips.indexOf(_dragChipSrc) < chips.indexOf(node)) node.after(_dragChipSrc)
            else node.before(_dragChipSrc)
        }

        node.addEventListener('dragstart', onDragstart)
        node.addEventListener('dragend',   onDragend)
        node.addEventListener('dragover',  onDragover)
        node.addEventListener('dragleave', onDragleave)
        node.addEventListener('drop',      onDrop)
        return {
            destroy() {
                node.removeEventListener('dragstart', onDragstart)
                node.removeEventListener('dragend',   onDragend)
                node.removeEventListener('dragover',  onDragover)
                node.removeEventListener('dragleave', onDragleave)
                node.removeEventListener('drop',      onDrop)
            }
        }
    }

    async function persistChipOrder(barId) {
        const row = barsListEl?.querySelector(`.pb-bar-row[data-bar-id="${barId}"]`)
        if (!row) return
        const ids = [...row.querySelectorAll('.pb-chip')].map(c => c.dataset.stepId)
        const bar = (page.bars ?? []).find(b => b.id === barId)
        if (!bar) return
        const map = new Map((bar.steps ?? []).map(s => [s.id, s]))
        bar.steps = ids.map(id => map.get(id)).filter(Boolean)
        await save()
    }

    onDestroy(() => { clearTimeout(_notesTimer) })
</script>

<div class="page-header">
    {#if page.appid}
        <a class="gj-sub-back" href="/journal/{page.appid}"
            onclick={(e) => { e.preventDefault(); navigate(`journal/${page.appid}`) }}>← Journal</a>
    {/if}
    <h1
        class="page-title page-title--editable"
        contenteditable="true"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }}
        onblur={onTitleBlur}
    >{page.title}</h1>
    <p class="page-subtitle">Multi-Bar Progress Tracker</p>
</div>

<div class="progress-global-bar">
    {#if segs.length === 0}
        <span class="progress-global-empty">No bars yet</span>
    {:else}
        {#each segs as seg}
            <div
                class="progress-global-seg{seg.optional ? ' progress-global-seg--optional' : ''}"
                style="background:{seg.color}"
                title={seg.label || `Bar ${seg.num}`}
                data-num={seg.num}
            >
                <span class="progress-seg-num">{seg.num}</span>
                {#if seg.stateLabel}<span class="progress-seg-state">{seg.stateLabel}</span>{/if}
            </div>
        {/each}
    {/if}
</div>

<div class="pb-body">
    <div class="pb-bars-list" bind:this={barsListEl}>
        {#each (page.bars ?? []) as bar (bar.id)}
            <div
                class={barRowClass(bar)}
                data-bar-id={bar.id}
                use:barDrag={bar.id}
                oncontextmenu={(e) => {
                    if (e.target.closest('.pb-chip')) return
                    e.preventDefault()
                    showContextMenu(e, [
                        { label: bar.optional ? 'Unmark Optional' : 'Mark Optional', action: () => toggleBarOptional(bar.id) },
                        'separator',
                        { label: 'Duplicate', action: () => copyBar(bar.id) },
                        { label: 'Delete', danger: true, action: () => deleteBar(bar.id) },
                    ])
                }}
            >
                <div class="pb-bar-handle" title="Drag to reorder">⠿</div>
                <div class="pb-bar-num">{(page.bars ?? []).findIndex(b => b.id === bar.id) + 1}</div>
                <div
                    class="pb-bar-title"
                    contenteditable="true"
                    aria-label="Bar title"
                    onmousedown={(e) => { if (e.button === 2) e.preventDefault() }}
                    onblur={(e) => onBarTitleBlur(bar.id, e)}
                    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }}
                >{bar.title}</div>
                {#if bar.optional}
                    <span class="progress-optional-tag">OPTIONAL</span>
                {/if}
                <div class="pb-chips">
                    {#each (bar.steps ?? []) as step (step.id)}
                        <div
                            class="pb-chip"
                            class:pb-chip--optional={step.optional && step.state !== 'done'}
                            class:pb-chip--optional-done={step.optional && step.state === 'done'}
                            data-step-id={step.id}
                            data-state={step.state ?? ''}
                            style={chipStyle(step)}
                            use:chipDrag={{ barId: bar.id, stepId: step.id }}
                            onclick={(e) => {
                                if (e.target.closest('.pb-chip-label')) return
                                cycleStepState(bar.id, step.id, e.currentTarget)
                            }}
                            oncontextmenu={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                showContextMenu(e, [
                                    { label: step.optional ? 'Unmark Optional' : 'Mark Optional', action: () => toggleStepOptional(bar.id, step.id) },
                                    'separator',
                                    { label: 'Delete', danger: true, action: () => deleteStep(bar.id, step.id) },
                                ])
                            }}
                        >
                            <span
                                class="pb-chip-label"
                                onmousedown={(e) => { if (e.button === 2) e.preventDefault() }}
                                onclick={(e) => {
                                    e.stopPropagation()
                                    const label = e.currentTarget
                                    if (label.contentEditable !== 'true') {
                                        label.contentEditable = 'true'
                                        label.focus()
                                        const range = document.createRange()
                                        range.selectNodeContents(label)
                                        const sel = window.getSelection()
                                        sel.removeAllRanges()
                                        sel.addRange(range)
                                    }
                                }}
                                onblur={(e) => {
                                    e.currentTarget.contentEditable = 'false'
                                    onStepTitleBlur(bar.id, step.id, e)
                                }}
                                onkeydown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); e.target.blur() }
                                    if (e.key === 'Escape') e.target.blur()
                                }}
                            >{step.title}</span>
                            <span class="pb-chip-state">{stateLabel(step.state)}</span>
                        </div>
                    {/each}
                    <button class="pb-chip-add" title="Add step" onclick={() => addStep(bar.id)}>+</button>
                </div>
            </div>
        {/each}
    </div>

    <button class="progress-add-btn" onclick={addBar}>+ Add Bar</button>

    <div class="progress-notes-wrap">
        <label class="progress-notes-label">Notes</label>
        <textarea class="progress-notes" placeholder="Add notes…" oninput={onNotesInput}>{page.notes ?? ''}</textarea>
    </div>
</div>
