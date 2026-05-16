import { api } from '../api.js'
import { escapeHtml } from '../utils.js'
import { refreshSidebarItem } from '../sidebar.js'

// ── Pure helpers (exported for tests) ─────────────────────────────────────────

export function sortedItems(page) {
    return [...page.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function reorderItems(items, fromIdx, toIdx) {
    const result = [...items]
    const [moved] = result.splice(fromIdx, 1)
    result.splice(toIdx, 0, moved)
    return result.map((item, i) => ({ ...item, order: i }))
}

// ── Module state ──────────────────────────────────────────────────────────────

let _page = null
let _container = null
let _dragChipSrc = null

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderList(page, container) {
    _page = deepCopy(page)
    _container = container
    _draw()
}

function deepCopy(page) {
    return {
        ...page,
        items: page.items.map(item => ({
            ...item,
            subtasks: [...(item.subtasks ?? [])],
        })),
    }
}

// ── Full render (called once on navigation) ───────────────────────────────────

function _draw() {
    _container.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'page-header'
    header.appendChild(_buildPageTitle())
    _container.appendChild(header)

    const listEl = document.createElement('div')
    listEl.className = 'list-items'
    _container.appendChild(listEl)

    for (const [i, item] of sortedItems(_page).entries()) {
        listEl.appendChild(buildItemEl(item, i + 1))
    }

    _setupDragDrop(listEl)

    const addBtn = document.createElement('button')
    addBtn.className = 'list-add-btn'
    addBtn.textContent = '+ Add Item'
    addBtn.addEventListener('click', _addItem)
    _container.appendChild(addBtn)
}

// ── Item element builder ──────────────────────────────────────────────────────

function buildItemEl(item, position) {
    const el = document.createElement('div')
    el.className = 'list-item' + (item.done ? ' list-item--done' : '')
    el.dataset.id = item.id

    // Main row: number/bullet + title + delete
    const mainRow = document.createElement('div')
    mainRow.className = 'list-item-main'

    const handle = document.createElement('span')
    handle.className = 'list-item-handle'
    handle.textContent = '⠿'
    handle.title = 'Drag to reorder'
    handle.addEventListener('mousedown', () => { el.draggable = true })
    mainRow.appendChild(handle)

    if (_page.ordered) {
        const num = document.createElement('span')
        num.className = 'list-item-num'
        num.textContent = position
        mainRow.appendChild(num)
    } else {
        const bullet = document.createElement('span')
        bullet.className = 'list-item-bullet'
        mainRow.appendChild(bullet)
    }

    const titleEl = document.createElement('span')
    titleEl.className = 'list-item-title'
    titleEl.contentEditable = 'true'
    titleEl.spellcheck = false
    titleEl.textContent = item.title
    titleEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault()
            titleEl.blur()
            const subtasksRow = el.querySelector('.list-subtasks')
            const addBtn = subtasksRow?.querySelector('.subtask-add-btn')
            if (subtasksRow && addBtn) _showSubtaskInput(item.id, subtasksRow, addBtn)
        }
        if (e.key === 'Escape') { titleEl.textContent = item.title; titleEl.blur() }
    })
    titleEl.addEventListener('blur', () => _saveTitle(item.id, titleEl.textContent.trim()))
    mainRow.appendChild(titleEl)

    const doneBtn = document.createElement('button')
    doneBtn.className = 'list-item-done-btn' + (item.done ? ' done' : '')
    doneBtn.innerHTML = '&#10003;'
    doneBtn.title = item.done ? 'Mark incomplete' : 'Mark complete'
    doneBtn.addEventListener('click', (e) => { e.stopPropagation(); _toggleDone(item.id, el) })
    mainRow.appendChild(doneBtn)

    const delBtn = document.createElement('button')
    delBtn.className = 'list-item-delete'
    delBtn.innerHTML = '&times;'
    delBtn.addEventListener('click', () => _deleteItem(item.id, el))
    mainRow.appendChild(delBtn)

    el.appendChild(mainRow)
    el.appendChild(buildSubtasksEl(item))

    return el
}

// ── Subtask section builder ───────────────────────────────────────────────────

function buildSubtasksEl(item) {
    const row = document.createElement('div')
    row.className = 'list-subtasks'

    for (const sub of item.subtasks) {
        row.appendChild(buildChipEl(item.id, sub))
    }

    const addBtn = document.createElement('button')
    addBtn.className = 'subtask-add-btn'
    addBtn.textContent = '+ subtask'
    addBtn.addEventListener('click', () => _showSubtaskInput(item.id, row, addBtn))
    row.appendChild(addBtn)

    return row
}

function buildChipEl(itemId, text) {
    const chip = document.createElement('span')
    chip.className = 'subtask-chip'
    chip.draggable = true

    const label = document.createElement('span')
    label.textContent = text
    chip.appendChild(label)

    const removeBtn = document.createElement('button')
    removeBtn.className = 'subtask-chip-remove'
    removeBtn.innerHTML = '&times;'
    removeBtn.addEventListener('click', () => {
        chip.remove()
        _removeSubtask(itemId, text)
    })
    chip.appendChild(removeBtn)

    chip.addEventListener('dragstart', (e) => {
        e.stopPropagation()
        _dragChipSrc = chip
        chip.classList.add('subtask-chip--dragging')
        e.dataTransfer.effectAllowed = 'move'
    })
    chip.addEventListener('dragend', () => {
        chip.classList.remove('subtask-chip--dragging')
        chip.parentElement?.querySelectorAll('.subtask-chip--drag-over')
            .forEach(x => x.classList.remove('subtask-chip--drag-over'))
        const src = _dragChipSrc
        _dragChipSrc = null
        if (src) _persistChipOrder(itemId, src.parentElement)
    })
    chip.addEventListener('dragover', (e) => {
        if (!_dragChipSrc || _dragChipSrc === chip) return
        e.preventDefault()
        e.stopPropagation()
        chip.parentElement?.querySelectorAll('.subtask-chip--drag-over')
            .forEach(x => x.classList.remove('subtask-chip--drag-over'))
        chip.classList.add('subtask-chip--drag-over')
    })
    chip.addEventListener('dragleave', () => chip.classList.remove('subtask-chip--drag-over'))
    chip.addEventListener('drop', (e) => {
        if (!_dragChipSrc || _dragChipSrc === chip) return
        e.preventDefault()
        e.stopPropagation()
        chip.classList.remove('subtask-chip--drag-over')
        if (_dragChipSrc.parentElement !== chip.parentElement) return
        const chips = [...chip.parentElement.querySelectorAll('.subtask-chip')]
        if (chips.indexOf(_dragChipSrc) < chips.indexOf(chip)) chip.after(_dragChipSrc)
        else chip.before(_dragChipSrc)
    })

    return chip
}

async function _persistChipOrder(itemId, row) {
    const item = _page.items.find(i => i.id === itemId)
    if (!item || !row) return
    item.subtasks = [...row.querySelectorAll('.subtask-chip')]
        .map(c => c.querySelector('span')?.textContent ?? '')
        .filter(Boolean)
    await _save()
}

// ── Subtask inline input ──────────────────────────────────────────────────────

function _showSubtaskInput(itemId, row, addBtn) {
    addBtn.style.display = 'none'

    const input = document.createElement('input')
    input.className = 'subtask-input'
    input.type = 'text'
    input.placeholder = 'Subtask name…'
    input.maxLength = 80

    const close = () => {
        const val = input.value.trim()
        input.remove()
        addBtn.style.display = ''
        if (val) _addSubtask(itemId, val, row, addBtn)
    }
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault()
            const val = input.value.trim()
            if (val) {
                _addSubtask(itemId, val, row, addBtn)
                input.value = ''
                row.insertBefore(input, addBtn)
                input.focus()
            }
        }
        if (e.key === 'Escape') { input.remove(); addBtn.style.display = '' }
    })
    input.addEventListener('blur', close)

    row.insertBefore(input, addBtn)
    input.focus()
}

// ── Data mutation + save helpers ──────────────────────────────────────────────

async function _toggleDone(itemId, el) {
    const item = _page.items.find(i => i.id === itemId)
    if (!item) return
    item.done = !item.done
    el.classList.toggle('list-item--done', item.done)
    const doneBtn = el.querySelector('.list-item-done-btn')
    if (doneBtn) {
        doneBtn.classList.toggle('done', item.done)
        doneBtn.title = item.done ? 'Mark incomplete' : 'Mark complete'
    }
    await _save()
}

async function _saveTitle(itemId, newTitle) {
    const item = _page.items.find(i => i.id === itemId)
    if (!item || item.title === newTitle) return
    item.title = newTitle
    await _save()
}

async function _deleteItem(itemId, el) {
    _page.items = _page.items.filter(i => i.id !== itemId)
    el.remove()
    _renumber()
    await _save()
}

async function _addItem() {
    const newItem = {
        id: crypto.randomUUID(),
        title: '',
        subtasks: [],
        order: _page.items.length,
    }
    _page.items.push(newItem)

    const listEl = _container.querySelector('.list-items')
    const el = buildItemEl(newItem, _page.items.length)
    listEl.appendChild(el)
    _container.querySelector('.list-add-btn')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    el.querySelector('.list-item-title')?.focus()

    await _save()
}

async function _addSubtask(itemId, text, row, addBtn) {
    const item = _page.items.find(i => i.id === itemId)
    if (!item || item.subtasks.includes(text)) return
    item.subtasks.push(text)
    row.insertBefore(buildChipEl(itemId, text), addBtn)
    await _save()
}

async function _removeSubtask(itemId, text) {
    const item = _page.items.find(i => i.id === itemId)
    if (!item) return
    item.subtasks = item.subtasks.filter(s => s !== text)
    await _save()
}

// ── Page title ────────────────────────────────────────────────────────────────

function _buildPageTitle() {
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

    const sub = document.createElement('div')
    sub.className = 'list-type-row'

    const toggle = document.createElement('button')
    toggle.className = 'list-type-toggle'
    toggle.dataset.role = 'list-type-toggle'
    _updateToggleLabel(toggle)
    toggle.addEventListener('click', () => _toggleOrdered(toggle))
    sub.appendChild(toggle)
    frag.appendChild(sub)

    return frag
}

function _updateToggleLabel(btn) {
    btn.textContent = _page.ordered ? '# Ordered' : '• Unordered'
}

async function _toggleOrdered(toggleBtn) {
    _page.ordered = !_page.ordered
    _updateToggleLabel(toggleBtn)
    // Swap number circles ↔ bullets in the DOM without a full redraw
    _container.querySelectorAll('.list-item').forEach((itemEl, i) => {
        const mainRow = itemEl.querySelector('.list-item-main')
        const existing = itemEl.querySelector('.list-item-num, .list-item-bullet')
        const item = _page.items.find(it => it.id === itemEl.dataset.id)
        if (!existing || !item) return

        if (_page.ordered) {
            const num = document.createElement('span')
            num.className = 'list-item-num'
            num.textContent = i + 1
            existing.replaceWith(num)
        } else {
            const bullet = document.createElement('span')
            bullet.className = 'list-item-bullet'
            existing.replaceWith(bullet)
        }
    })
    await _save()
}

// ── Save to API ───────────────────────────────────────────────────────────────

async function _save() {
    try {
        await api.pages.update(_page.id, { items: _page.items, ordered: _page.ordered })
        refreshSidebarItem({ ..._page })
    } catch (err) {
        console.error('Failed to save list', err)
    }
}

// ── Renumber ordered items after delete / reorder ─────────────────────────────

function _renumber() {
    if (!_page.ordered) return
    _container.querySelectorAll('.list-item .list-item-num').forEach((el, i) => {
        el.textContent = i + 1
    })
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

function _setupDragDrop(listEl) {
    let dragId = null

    listEl.addEventListener('dragstart', e => {
        const item = e.target.closest('.list-item')
        if (!item) return
        dragId = item.dataset.id
        item.classList.add('dragging')
        e.dataTransfer.effectAllowed = 'move'
    })

    listEl.addEventListener('dragend', e => {
        const item = e.target.closest('.list-item')
        if (item) {
            item.draggable = false
            item.classList.remove('dragging')
        }
        listEl.querySelectorAll('.list-item.drag-over').forEach(el => el.classList.remove('drag-over'))
        dragId = null
        // _dragChipSrc is cleared by the chip's own dragend handler
    })

    listEl.addEventListener('dragover', e => {
        e.preventDefault()
        const target = e.target.closest('.list-item')
        if (!target || target.dataset.id === dragId) return
        listEl.querySelectorAll('.list-item.drag-over').forEach(el => el.classList.remove('drag-over'))
        target.classList.add('drag-over')
    })

    listEl.addEventListener('drop', e => {
        e.preventDefault()
        const target = e.target.closest('.list-item')
        if (!target) return
        listEl.querySelectorAll('.list-item.drag-over').forEach(el => el.classList.remove('drag-over'))

        // ── Chip cross-item drop ──────────────────────────────────────────────
        if (_dragChipSrc) {
            const srcItem = _dragChipSrc.closest('.list-item')
            if (!srcItem || srcItem === target) return
            const srcId = srcItem.dataset.id
            const tgtId = target.dataset.id

            // Move chip DOM into target's subtask row (before + subtask button)
            const tgtRow = target.querySelector('.list-subtasks')
            const addBtn = tgtRow?.querySelector('.subtask-add-btn')
            if (tgtRow) tgtRow.insertBefore(_dragChipSrc, addBtn ?? null)

            // Sync subtask arrays from DOM for both items
            const srcData = _page.items.find(i => i.id === srcId)
            const tgtData = _page.items.find(i => i.id === tgtId)
            if (srcData) {
                srcData.subtasks = [...srcItem.querySelectorAll('.subtask-chip')]
                    .map(c => c.querySelector('span')?.textContent ?? '').filter(Boolean)
            }
            if (tgtData) {
                tgtData.subtasks = [...tgtRow.querySelectorAll('.subtask-chip')]
                    .map(c => c.querySelector('span')?.textContent ?? '').filter(Boolean)
            }
            _save()
            return
        }

        // ── Item reorder drop ─────────────────────────────────────────────────
        if (target.dataset.id === dragId) return
        const els = [...listEl.querySelectorAll('.list-item')]
        const fromIdx = els.findIndex(el => el.dataset.id === dragId)
        const toIdx   = els.findIndex(el => el === target)
        if (fromIdx === -1 || toIdx === -1) return

        if (fromIdx < toIdx) target.after(els[fromIdx])
        else target.before(els[fromIdx])

        _page.items = reorderItems(_page.items, fromIdx, toIdx)
        _renumber()
        _save()
    })
}
