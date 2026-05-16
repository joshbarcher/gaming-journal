import { api } from '../api.js'
import { escapeHtml } from '../utils.js'
import { refreshSidebarItem } from '../sidebar.js'
import { segmentColor, globalSegments } from './progress-helpers.js'
import { fireParticles } from '../particles.js'
import { showContextMenu } from './context-menu.js'

const STATES = ['started', 'working', 'done']
const STATE_LABELS = { started: 'STARTED', working: 'WORKING', done: 'DONE' }

// ── Module state ──────────────────────────────────────────────────────────────

let _page = null
let _container = null
let _dragTaskSrc = null

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderProgress(page, container) {
    _page = JSON.parse(JSON.stringify(page))
    _container = container
    _draw()
}

// ── Full render ───────────────────────────────────────────────────────────────

function _draw() {
    _container.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'page-header'
    header.appendChild(_buildPageTitle('Progress Tracker'))
    _container.appendChild(header)

    const globalBar = document.createElement('div')
    globalBar.className = 'progress-global-bar'
    globalBar.dataset.role = 'global-bar'
    _container.appendChild(globalBar)
    _redrawGlobalBar()

    const taskList = document.createElement('div')
    taskList.className = 'progress-tasks'
    taskList.dataset.role = 'task-list'
    _container.appendChild(taskList)

    for (const task of (_page.tasks ?? [])) {
        taskList.appendChild(_buildTaskEl(task))
    }

    const addBtn = document.createElement('button')
    addBtn.className = 'progress-add-btn'
    addBtn.dataset.role = 'add-task'
    addBtn.textContent = '+ Add Task'
    _container.appendChild(addBtn)
    addBtn.addEventListener('click', _addTask)

    const notesWrap = document.createElement('div')
    notesWrap.className = 'progress-notes-wrap'
    notesWrap.dataset.role = 'notes-wrap'
    notesWrap.innerHTML = `
        <label class="progress-notes-label">Notes</label>
        <textarea class="progress-notes" placeholder="Add notes…">${escapeHtml(_page.notes ?? '')}</textarea>`
    _container.appendChild(notesWrap)

    notesWrap.querySelector('textarea').addEventListener('input', _onNotesInput)
}

// ── Global bar ────────────────────────────────────────────────────────────────

function _redrawGlobalBar() {
    const bar = _container.querySelector('[data-role="global-bar"]')
    if (!bar) return
    const segs = globalSegments(_page)
    bar.innerHTML = ''
    if (!segs.length) {
        bar.innerHTML = '<span class="progress-global-empty">No tasks yet</span>'
        return
    }
    for (const seg of segs) {
        const el = document.createElement('div')
        el.className = 'progress-global-seg' + (seg.optional ? ' progress-global-seg--optional' : '')
        el.style.background = seg.color
        el.title = seg.label || `Task ${seg.num}`
        el.dataset.num = seg.num
        el.innerHTML = `
            <span class="progress-seg-num">${seg.num}</span>
            ${seg.stateLabel ? `<span class="progress-seg-state">${seg.stateLabel}</span>` : ''}`
        bar.appendChild(el)
    }
}

// ── Task element ──────────────────────────────────────────────────────────────

function _buildTaskEl(task) {
    const el = document.createElement('div')
    el.className = 'progress-task' + (task.optional ? ' progress-task--optional' : '')
    el.dataset.id = task.id

    const handle = document.createElement('div')
    handle.className = 'progress-task-handle'
    handle.textContent = '⠿'
    handle.title = 'Drag to reorder'
    handle.addEventListener('mousedown', () => { el.draggable = true })
    el.appendChild(handle)

    const titleEl = document.createElement('div')
    titleEl.className = 'progress-task-title'
    titleEl.contentEditable = 'true'
    titleEl.textContent = task.title ?? ''
    titleEl.setAttribute('aria-label', 'Task title')
    titleEl.addEventListener('mousedown', e => { if (e.button === 2) e.preventDefault() })
    titleEl.addEventListener('blur', e => _onTitleBlur(task.id, e.target.textContent.trim()))
    titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } })
    el.appendChild(titleEl)

    if (task.optional) {
        const tag = document.createElement('span')
        tag.className = 'progress-optional-tag'
        tag.textContent = 'OPTIONAL'
        el.appendChild(tag)
    }

    const btns = document.createElement('div')
    btns.className = 'progress-state-btns'
    for (const state of STATES) {
        const btn = document.createElement('button')
        btn.className = 'progress-state-btn'
        btn.dataset.state = state
        btn.textContent = STATE_LABELS[state]
        if (task.state === state) btn.classList.add('active')
        btn.style.setProperty('--state-color', segmentColor(state))
        btn.addEventListener('click', e => _onStateClick(task.id, state, e.currentTarget))
        btns.appendChild(btn)
    }
    el.appendChild(btns)

    el.addEventListener('contextmenu', e => {
        showContextMenu(e, [
            {
                label: task.optional ? 'Unmark Optional' : 'Mark Optional',
                action: () => _toggleTaskOptional(task.id),
            },
            'separator',
            { label: 'Delete', danger: true, action: () => _deleteTask(task.id) },
        ])
    })

    _attachTaskDrag(el)

    return el
}

// ── Task drag-to-reorder ──────────────────────────────────────────────────────

function _attachTaskDrag(el) {
    el.addEventListener('dragstart', (e) => {
        _dragTaskSrc = el
        el.classList.add('progress-task--dragging')
        e.dataTransfer.effectAllowed = 'move'
    })
    el.addEventListener('dragend', () => {
        el.draggable = false
        el.classList.remove('progress-task--dragging')
        _container.querySelectorAll('.progress-task--drag-over').forEach(x => x.classList.remove('progress-task--drag-over'))
        _dragTaskSrc = null
        _persistTaskOrder()
    })
    el.addEventListener('dragover', (e) => {
        if (!_dragTaskSrc || _dragTaskSrc === el) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        _container.querySelectorAll('.progress-task--drag-over').forEach(x => x.classList.remove('progress-task--drag-over'))
        el.classList.add('progress-task--drag-over')
    })
    el.addEventListener('dragleave', (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('progress-task--drag-over')
    })
    el.addEventListener('drop', (e) => {
        if (!_dragTaskSrc || _dragTaskSrc === el) return
        e.preventDefault()
        el.classList.remove('progress-task--drag-over')
        const list = _container.querySelector('[data-role="task-list"]')
        const items = [...list.querySelectorAll('.progress-task')]
        if (items.indexOf(_dragTaskSrc) < items.indexOf(el)) el.after(_dragTaskSrc)
        else el.before(_dragTaskSrc)
    })
}

async function _persistTaskOrder() {
    const list = _container.querySelector('[data-role="task-list"]')
    const ids = [...list.querySelectorAll('.progress-task')].map(el => el.dataset.id)
    const map = new Map((_page.tasks ?? []).map(t => [t.id, t]))
    _page.tasks = ids.map(id => map.get(id)).filter(Boolean)
    _redrawGlobalBar()
    await _save()
}

function _refreshTaskEl(taskId) {
    const task = (_page.tasks ?? []).find(t => t.id === taskId)
    if (!task) return
    const el = _container.querySelector(`.progress-task[data-id="${taskId}"]`)
    if (!el) return
    for (const btn of el.querySelectorAll('.progress-state-btn')) {
        btn.classList.toggle('active', btn.dataset.state === task.state)
    }
}

// ── Interactions ──────────────────────────────────────────────────────────────

async function _onStateClick(taskId, state, btnEl) {
    const task = (_page.tasks ?? []).find(t => t.id === taskId)
    if (!task) return
    const prev = task.state
    task.state = task.state === state ? null : state
    _refreshTaskEl(taskId)
    _redrawGlobalBar()
    if (task.state === 'done' && prev !== 'done') {
        const required = (_page.tasks ?? []).filter(t => !t.optional)
        if (required.length > 0 && required.every(t => t.state === 'done')) {
            fireParticles(btnEl, _page.title)
        }
    }
    await _save()
}

async function _onTitleBlur(taskId, newTitle) {
    const task = (_page.tasks ?? []).find(t => t.id === taskId)
    if (!task || task.title === newTitle) return
    task.title = newTitle
    _redrawGlobalBar()
    await _save()
}

let _notesTimer = null
function _onNotesInput(e) {
    _page.notes = e.target.value
    clearTimeout(_notesTimer)
    _notesTimer = setTimeout(_save, 800)
}

async function _addTask() {
    const task = { id: crypto.randomUUID(), title: '', state: null }
    _page.tasks = [...(_page.tasks ?? []), task]

    const list = _container.querySelector('[data-role="task-list"]')
    const el = _buildTaskEl(task)
    list.appendChild(el)
    _redrawGlobalBar()
    el.querySelector('.progress-task-title').focus()
    await _save()
}

async function _deleteTask(taskId) {
    _page.tasks = (_page.tasks ?? []).filter(t => t.id !== taskId)
    const el = _container.querySelector(`.progress-task[data-id="${taskId}"]`)
    el?.remove()
    _redrawGlobalBar()
    await _save()
}

async function _toggleTaskOptional(taskId) {
    const task = (_page.tasks ?? []).find(t => t.id === taskId)
    if (!task) return
    task.optional = !task.optional
    const el = _container.querySelector(`.progress-task[data-id="${taskId}"]`)
    if (el) el.replaceWith(_buildTaskEl(task))
    _redrawGlobalBar()
    await _save()
}

// ── Page title ────────────────────────────────────────────────────────────────

function _buildPageTitle(subtitle) {
    const frag = document.createDocumentFragment()
    const h1 = document.createElement('h1')
    h1.className = 'page-title page-title--editable'
    h1.contentEditable = 'true'
    h1.textContent = _page.title
    h1.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); h1.blur() } })
    h1.addEventListener('blur', async () => {
        const t = h1.textContent.trim()
        if (!t || t === _page.title) { h1.textContent = _page.title; return }
        _page.title = t
        const updated = await api.pages.update(_page.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    })
    frag.appendChild(h1)
    const sub = document.createElement('p')
    sub.className = 'page-subtitle'
    sub.textContent = subtitle
    frag.appendChild(sub)
    return frag
}

// ── Persist ───────────────────────────────────────────────────────────────────

async function _save() {
    const updated = await api.pages.update(_page.id, {
        tasks: _page.tasks,
        notes: _page.notes,
    })
    if (updated) refreshSidebarItem(updated)
}
