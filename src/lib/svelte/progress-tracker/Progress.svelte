<script lang="ts">
    import type { ProgressPage, Task, TaskState } from '../../types.js'
    import { onMount } from 'svelte'
    import { api } from '../../js/api.js'
    import { uuid } from '../../js/utils.js'
    import { refreshSidebarItem } from '../../js/sidebar.js'
    import { segmentColor, globalSegments } from '../../js/views/progress-helpers.js'
    import { fireParticles } from '../../js/particles.js'
    import { showContextMenu } from '../../js/views/context-menu.js'
    import { navigate } from '../../js/router.js'
    import Breadcrumb from '../Breadcrumb.svelte'

    const STATES: TaskState[] = ['started', 'working', 'done']
    const STATE_LABELS = { started: 'STARTED', working: 'WORKING', done: 'DONE' }

    let { page: pageProp } = $props()

    let pd           = $state<ProgressPage>(JSON.parse(JSON.stringify(pageProp)))
    let draggedId    = $state<string | null>(null)
    let dropTargetId = $state<string | null>(null)
    let draggableId  = $state<string | null>(null)
    let notesTimer: ReturnType<typeof setTimeout> | null = null

    let segs = $derived(globalSegments(pd))

    async function onTitleBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
        const t = (e.currentTarget.textContent ?? '').trim()
        if (!t || t === pd.title) { e.currentTarget.textContent = pd.title; return }
        pd.title = t
        const updated = await api.pages.update(pd.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    }

    async function onTaskTitleBlur(taskId: string, e: FocusEvent & { currentTarget: HTMLElement }) {
        const newTitle = (e.currentTarget.textContent ?? '').trim()
        const task = (pd.tasks ?? []).find((t: Task) => t.id === taskId)
        if (!task || task.title === newTitle) return
        task.title = newTitle
        await save()
    }

    async function onStateClick(taskId: string, state: TaskState, btnEl: HTMLElement) {
        const task = (pd.tasks ?? []).find((t: Task) => t.id === taskId)
        if (!task) return
        const prev = task.state
        task.state = task.state === state ? null : state
        if (task.state === 'done' && prev !== 'done') {
            const required = (pd.tasks ?? []).filter((t: Task) => !t.optional)
            if (required.length > 0 && required.every((t: Task) => t.state === 'done')) {
                fireParticles(btnEl, pd.title)
            }
        }
        await save()
    }

    function onNotesInput(e: Event) {
        pd.notes = (e.target as HTMLTextAreaElement).value
        clearTimeout(notesTimer ?? undefined)
        notesTimer = setTimeout(save, 800)
    }

    async function addTask() {
        const task = { id: uuid(), title: '', state: null }
        pd.tasks = [...(pd.tasks ?? []), task]
        await save()
        requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`.progress-task[data-id="${task.id}"] .progress-task-title`)?.focus()
        })
    }

    async function deleteTask(taskId: string) {
        pd.tasks = (pd.tasks ?? []).filter((t: Task) => t.id !== taskId)
        await save()
    }

    async function toggleTaskOptional(taskId: string) {
        const task = (pd.tasks ?? []).find((t: Task) => t.id === taskId)
        if (!task) return
        task.optional = !task.optional
        await save()
    }

    function onContextMenu(e: MouseEvent, taskId: string) {
        const task = (pd.tasks ?? []).find((t: Task) => t.id === taskId)
        if (!task) return
        showContextMenu(e, [
            { label: task.optional ? 'Unmark Optional' : 'Mark Optional', action: () => toggleTaskOptional(taskId) },
            'separator',
            { label: 'Delete', danger: true, action: () => deleteTask(taskId) },
        ])
    }

    function onDragStart(e: DragEvent, taskId: string) {
        requestAnimationFrame(() => { draggedId = taskId })
        e.dataTransfer!.effectAllowed = 'move'
    }

    function onDragEnd() {
        draggableId  = null
        draggedId    = null
        dropTargetId = null
    }

    function onDragOver(e: DragEvent, taskId: string) {
        if (!draggedId || draggedId === taskId) return
        e.preventDefault()
        e.dataTransfer!.dropEffect = 'move'
        dropTargetId = taskId
    }

    function onDragLeave(taskId: string) {
        if (dropTargetId === taskId) dropTargetId = null
    }

    async function onDrop(e: DragEvent, taskId: string) {
        if (!draggedId || draggedId === taskId) return
        e.preventDefault()
        dropTargetId = null
        const tasks   = pd.tasks ?? []
        const fromIdx = tasks.findIndex((t: Task) => t.id === draggedId)
        const toIdx   = tasks.findIndex((t: Task) => t.id === taskId)
        if (fromIdx === -1 || toIdx === -1) return
        const next = [...tasks]
        const [moved] = next.splice(fromIdx, 1)
        next.splice(toIdx, 0, moved)
        pd.tasks = next
        await save()
    }

    async function save() {
        const updated = await api.pages.update(pd.id, { tasks: pd.tasks, notes: pd.notes })
        if (updated) refreshSidebarItem(updated)
    }

    let gameName = $state('')
    onMount(async () => {
        if (!pd.appid) return
        try {
            const res = await fetch(`/relay/api/games/${pd.appid}`)
            if (res.ok) gameName = (await res.json())?.name ?? ''
        } catch { /* silent */ }
    })
</script>

{#if pd.appid}
<div class="gj-sub-header">
    <Breadcrumb crumbs={[
        { label: 'Home', href: '/' },
        { label: gameName || '…', href: `/game/${pd.appid}` },
        { label: 'Journal', href: `/journal/${pd.appid}` },
        { label: 'Progress Trackers', href: `/journal/${pd.appid}/progress` },
        { label: pd.title },
    ]} />
</div>
{/if}

<div class="page-header">
    <h1 class="page-title page-title--editable" contenteditable="true"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        onblur={onTitleBlur}>{pd.title}</h1>
    <p class="page-subtitle">Progress Tracker</p>
</div>

<div class="progress-global-bar">
    {#if segs.length === 0}
        <span class="progress-global-empty">No tasks yet</span>
    {:else}
        {#each segs as seg (seg.num)}
            <div class="progress-global-seg{seg.optional ? ' progress-global-seg--optional' : ''}"
                 style="background:{seg.color}"
                 title={seg.label || `Task ${seg.num}`}
                 data-num={seg.num}>
                <span class="progress-seg-label">{seg.label || String(seg.num)}</span>
                {#if seg.stateLabel}<span class="progress-seg-state">{seg.stateLabel}</span>{/if}
            </div>
        {/each}
    {/if}
</div>

<div class="progress-tasks">
    {#each (pd.tasks ?? []) as task (task.id)}
        <div class="progress-task{task.optional ? ' progress-task--optional' : ''}"
             class:progress-task--dragging={draggedId === task.id}
             class:progress-task--drag-over={dropTargetId === task.id}
             data-id={task.id}
             draggable={draggableId === task.id}
             ondragstart={(e) => onDragStart(e, task.id)}
             ondragend={onDragEnd}
             ondragover={(e) => onDragOver(e, task.id)}
             ondragleave={() => onDragLeave(task.id)}
             ondrop={(e) => onDrop(e, task.id)}
             oncontextmenu={(e) => onContextMenu(e, task.id)}>
            <div class="progress-task-handle" title="Drag to reorder"
                 onmousedown={() => { draggableId = task.id }}>⠿</div>
            <div class="progress-task-title" contenteditable="true" aria-label="Task title"
                 onmousedown={(e) => { if (e.button === 2) e.preventDefault() }}
                 onblur={(e) => onTaskTitleBlur(task.id, e)}
                 onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}>{task.title ?? ''}</div>
            {#if task.optional}
                <span class="progress-optional-tag">OPTIONAL</span>
            {/if}
            <div class="progress-state-btns">
                {#each STATES as state}
                    <button class="progress-state-btn"
                            class:active={task.state === state}
                            data-state={state}
                            style="--state-color:{segmentColor(state)}"
                            onclick={(e) => onStateClick(task.id, state, e.currentTarget)}>{(STATE_LABELS as Record<string, string>)[state]}</button>
                {/each}
            </div>
        </div>
    {/each}
</div>

<button class="progress-add-btn" onclick={addTask}>+ Add Task</button>

<div class="progress-notes-wrap">
    <label class="progress-notes-label">Notes</label>
    <textarea class="progress-notes" placeholder="Add notes…"
              oninput={onNotesInput}>{pd.notes ?? ''}</textarea>
</div>
