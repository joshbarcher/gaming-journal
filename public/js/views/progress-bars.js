import { api } from '../api.js'
import { escapeHtml } from '../utils.js'
import { refreshSidebarItem } from '../sidebar.js'
import { segmentColor, barProgressPercent, percentToColor, globalSegments, stateLabel } from './progress-helpers.js'
import { fireParticles } from '../particles.js'
import { showContextMenu } from './context-menu.js'
import { navigate } from '../router.js'

const STATE_CYCLE = [null, 'started', 'working', 'done']

// ── Module state ──────────────────────────────────────────────────────────────

let _page = null
let _container = null
let _dragBarSrc  = null
let _dragChipSrc = null

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderProgressBars(page, container) {
    _page = JSON.parse(JSON.stringify(page))
    _container = container
    _draw()
}

// ── Full render ───────────────────────────────────────────────────────────────

function _draw() {
    _container.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'page-header'
    header.appendChild(_buildPageTitle('Multi-Bar Progress Tracker'))
    _container.appendChild(header)

    const globalBar = document.createElement('div')
    globalBar.className = 'progress-global-bar'
    globalBar.dataset.role = 'global-bar'
    _container.appendChild(globalBar)
    _redrawGlobalBar()

    const body = document.createElement('div')
    body.className = 'pb-body'
    _container.appendChild(body)

    const barsList = document.createElement('div')
    barsList.className = 'pb-bars-list'
    barsList.dataset.role = 'bars-list'
    body.appendChild(barsList)

    for (const bar of (_page.bars ?? [])) {
        barsList.appendChild(_buildBarRow(bar))
    }

    const addBtn = document.createElement('button')
    addBtn.className = 'progress-add-btn'
    addBtn.dataset.role = 'add-bar'
    addBtn.textContent = '+ Add Bar'
    body.appendChild(addBtn)
    addBtn.addEventListener('click', _addBar)

    const notesWrap = document.createElement('div')
    notesWrap.className = 'progress-notes-wrap'
    notesWrap.dataset.role = 'notes-wrap'
    notesWrap.innerHTML = `
        <label class="progress-notes-label">Notes</label>
        <textarea class="progress-notes" placeholder="Add notes…">${escapeHtml(_page.notes ?? '')}</textarea>`
    body.appendChild(notesWrap)

    notesWrap.querySelector('textarea').addEventListener('input', _onNotesInput)
}

// ── Global bar ────────────────────────────────────────────────────────────────

function _redrawGlobalBar() {
    const bar = _container.querySelector('[data-role="global-bar"]')
    if (!bar) return
    const segs = globalSegments(_page)
    bar.innerHTML = ''
    if (!segs.length) {
        bar.innerHTML = '<span class="progress-global-empty">No bars yet</span>'
        return
    }
    for (const seg of segs) {
        const el = document.createElement('div')
        el.className = 'progress-global-seg' + (seg.optional ? ' progress-global-seg--optional' : '')
        el.style.background = seg.color
        el.title = seg.label || `Bar ${seg.num}`
        el.dataset.num = seg.num
        el.innerHTML = `
            <span class="progress-seg-num">${seg.num}</span>
            ${seg.stateLabel ? `<span class="progress-seg-state">${seg.stateLabel}</span>` : ''}`
        bar.appendChild(el)
    }
}

// ── Bar row (compact) ─────────────────────────────────────────────────────────

function _barRowClass(bar) {
    const pct = barProgressPercent(bar)
    let cls = 'pb-bar-row'
    if (bar.optional) cls += pct >= 100 ? ' pb-bar-row--optional-done' : ' pb-bar-row--optional'
    return cls
}

function _refreshBarRowClass(barId) {
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar) return
    const row = _container.querySelector(`.pb-bar-row[data-bar-id="${barId}"]`)
    if (!row) return
    const pct = barProgressPercent(bar)
    row.classList.remove('pb-bar-row--optional', 'pb-bar-row--optional-done')
    if (bar.optional) row.classList.add(pct >= 100 ? 'pb-bar-row--optional-done' : 'pb-bar-row--optional')
}

function _buildBarRow(bar) {
    const row = document.createElement('div')
    row.className = _barRowClass(bar)
    row.dataset.barId = bar.id

    // Drag handle
    const handle = document.createElement('div')
    handle.className = 'pb-bar-handle'
    handle.textContent = '⠿'
    handle.title = 'Drag to reorder'
    handle.addEventListener('mousedown', () => { row.draggable = true })
    row.appendChild(handle)

    // Number
    const num = document.createElement('div')
    num.className = 'pb-bar-num'
    num.dataset.role = 'bar-num'
    num.textContent = (_page.bars ?? []).findIndex(b => b.id === bar.id) + 1
    row.appendChild(num)

    // Title (inline editable)
    const titleEl = document.createElement('div')
    titleEl.className = 'pb-bar-title'
    titleEl.contentEditable = 'true'
    titleEl.textContent = bar.title ?? ''
    titleEl.setAttribute('aria-label', 'Bar title')
    titleEl.addEventListener('mousedown', e => { if (e.button === 2) e.preventDefault() })
    titleEl.addEventListener('blur', e => _onBarTitleBlur(bar.id, e.target.textContent.trim()))
    titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } })
    row.appendChild(titleEl)

    if (bar.optional) {
        const tag = document.createElement('span')
        tag.className = 'progress-optional-tag'
        tag.textContent = 'OPTIONAL'
        row.appendChild(tag)
    }

    // Chips
    const chips = document.createElement('div')
    chips.className = 'pb-chips'
    chips.dataset.role = 'chips'
    for (const step of (bar.steps ?? [])) {
        chips.appendChild(_buildChip(bar.id, step))
    }
    const addChip = document.createElement('button')
    addChip.className = 'pb-chip-add'
    addChip.textContent = '+'
    addChip.title = 'Add step'
    addChip.addEventListener('click', () => _addStep(bar.id))
    chips.appendChild(addChip)
    row.appendChild(chips)

    // Right-click context menu (replaces inline copy/delete buttons)
    row.addEventListener('contextmenu', e => {
        if (e.target.closest('.pb-chip')) return  // chips have their own menu
        showContextMenu(e, [
            {
                label: bar.optional ? 'Unmark Optional' : 'Mark Optional',
                action: () => _toggleBarOptional(bar.id),
            },
            'separator',
            { label: 'Duplicate', action: () => _copyBar(bar.id) },
            { label: 'Delete', danger: true, action: () => _deleteBar(bar.id) },
        ])
    })

    _attachBarDrag(row)

    return row
}

// ── Step chip ─────────────────────────────────────────────────────────────────

function _buildChip(barId, step) {
    const chip = document.createElement('div')
    chip.className = 'pb-chip'
    chip.dataset.stepId = step.id
    _applyChipState(chip, step.state, step.optional)

    const label = document.createElement('span')
    label.className = 'pb-chip-label'
    label.textContent = step.title ?? ''
    chip.appendChild(label)

    const stateLabelEl = document.createElement('span')
    stateLabelEl.className = 'pb-chip-state'
    stateLabelEl.textContent = stateLabel(step.state)
    chip.appendChild(stateLabelEl)

    // Click on chip body → cycle state (unless clicking the label)
    chip.addEventListener('click', e => {
        if (label.contains(e.target)) return
        _cycleStepState(barId, step.id, chip)
    })

    // Click label → edit title
    const enterLabelEdit = () => {
        label.contentEditable = 'true'
        label.focus()
        const range = document.createRange()
        range.selectNodeContents(label)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
    }
    label.addEventListener('mousedown', e => { if (e.button === 2) e.preventDefault() })
    label.addEventListener('click', e => {
        e.stopPropagation()
        if (label.contentEditable !== 'true') enterLabelEdit()
    })
    label.addEventListener('blur', e => {
        label.contentEditable = 'false'
        _onStepTitleBlur(barId, step.id, e.target.textContent.trim())
    })
    label.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur() }
        if (e.key === 'Escape') { e.target.blur() }
    })

    // Right-click context menu (replaces inline delete button)
    chip.addEventListener('contextmenu', e => {
        e.stopPropagation()
        showContextMenu(e, [
            {
                label: step.optional ? 'Unmark Optional' : 'Mark Optional',
                action: () => _toggleStepOptional(barId, step.id),
            },
            'separator',
            { label: 'Delete', danger: true, action: () => _deleteStep(barId, step.id) },
        ])
    })

    _attachChipDrag(chip, barId)

    return chip
}

// ── Bar drag-to-reorder ───────────────────────────────────────────────────────

function _attachBarDrag(row) {
    row.addEventListener('dragstart', (e) => {
        _dragBarSrc = row
        row.classList.add('pb-bar-row--dragging')
        e.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => {
        row.draggable = false
        row.classList.remove('pb-bar-row--dragging')
        _container.querySelectorAll('.pb-bar-row--drag-over').forEach(x => x.classList.remove('pb-bar-row--drag-over'))
        _dragBarSrc = null
        _persistBarOrder()
    })
    row.addEventListener('dragover', (e) => {
        if (!_dragBarSrc || _dragBarSrc === row || _dragChipSrc) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        _container.querySelectorAll('.pb-bar-row--drag-over').forEach(x => x.classList.remove('pb-bar-row--drag-over'))
        row.classList.add('pb-bar-row--drag-over')
    })
    row.addEventListener('dragleave', (e) => {
        if (!row.contains(e.relatedTarget)) row.classList.remove('pb-bar-row--drag-over')
    })
    row.addEventListener('drop', (e) => {
        if (!_dragBarSrc || _dragBarSrc === row || _dragChipSrc) return
        e.preventDefault()
        row.classList.remove('pb-bar-row--drag-over')
        const list = _container.querySelector('[data-role="bars-list"]')
        const rows = [...list.querySelectorAll('.pb-bar-row')]
        if (rows.indexOf(_dragBarSrc) < rows.indexOf(row)) row.after(_dragBarSrc)
        else row.before(_dragBarSrc)
    })
}

async function _persistBarOrder() {
    const list = _container.querySelector('[data-role="bars-list"]')
    const ids = [...list.querySelectorAll('.pb-bar-row')].map(r => r.dataset.barId)
    const map = new Map((_page.bars ?? []).map(b => [b.id, b]))
    _page.bars = ids.map(id => map.get(id)).filter(Boolean)
    _refreshBarNums()
    _redrawGlobalBar()
    await _save()
}

// ── Chip drag-to-reorder ──────────────────────────────────────────────────────

function _attachChipDrag(chip, barId) {
    chip.draggable = true
    chip.addEventListener('dragstart', (e) => {
        e.stopPropagation()
        _dragChipSrc = chip
        chip.classList.add('pb-chip--dragging')
        e.dataTransfer.effectAllowed = 'move'
    })
    chip.addEventListener('dragend', () => {
        chip.classList.remove('pb-chip--dragging')
        _container.querySelectorAll('.pb-chip--drag-over').forEach(x => x.classList.remove('pb-chip--drag-over'))
        _dragChipSrc = null
        _persistChipOrder(barId)
    })
    chip.addEventListener('dragover', (e) => {
        if (!_dragChipSrc || _dragChipSrc === chip) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        _container.querySelectorAll('.pb-chip--drag-over').forEach(x => x.classList.remove('pb-chip--drag-over'))
        chip.classList.add('pb-chip--drag-over')
    })
    chip.addEventListener('dragleave', () => chip.classList.remove('pb-chip--drag-over'))
    chip.addEventListener('drop', (e) => {
        if (!_dragChipSrc || _dragChipSrc === chip) return
        e.preventDefault()
        e.stopPropagation()
        chip.classList.remove('pb-chip--drag-over')
        if (_dragChipSrc.parentElement !== chip.parentElement) return
        const chips = [...chip.parentElement.querySelectorAll('.pb-chip')]
        if (chips.indexOf(_dragChipSrc) < chips.indexOf(chip)) chip.after(_dragChipSrc)
        else chip.before(_dragChipSrc)
    })
}

async function _persistChipOrder(barId) {
    const row = _container.querySelector(`.pb-bar-row[data-bar-id="${barId}"]`)
    if (!row) return
    const ids = [...row.querySelectorAll('.pb-chip')].map(c => c.dataset.stepId)
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar) return
    const map = new Map((bar.steps ?? []).map(s => [s.id, s]))
    bar.steps = ids.map(id => map.get(id)).filter(Boolean)
    await _save()
}

function _applyChipState(chip, state, optional = false) {
    chip.dataset.state = state ?? ''
    chip.style.background = state ? segmentColor(state) : 'rgba(255,255,255,0.07)'
    chip.style.color = state ? 'rgba(0,0,0,0.75)' : 'var(--clr-text-muted)'
    const sl = chip.querySelector('.pb-chip-state')
    if (sl) sl.textContent = stateLabel(state)
    if (optional) {
        chip.classList.toggle('pb-chip--optional',      state !== 'done')
        chip.classList.toggle('pb-chip--optional-done', state === 'done')
    }
}

function _refreshBarNums() {
    const rows = _container.querySelectorAll('.pb-bar-row')
    rows.forEach((row, i) => {
        const numEl = row.querySelector('[data-role="bar-num"]')
        if (numEl) numEl.textContent = i + 1
    })
}

// ── Interactions ──────────────────────────────────────────────────────────────

async function _cycleStepState(barId, stepId, chipEl) {
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar) return
    const step = (bar.steps ?? []).find(s => s.id === stepId)
    if (!step) return
    const prev = step.state
    const idx = STATE_CYCLE.indexOf(step.state)
    step.state = STATE_CYCLE[(idx + 1) % STATE_CYCLE.length]
    _applyChipState(chipEl, step.state, step.optional)
    _refreshBarRowClass(barId)
    _redrawGlobalBar()
    if (step.state === 'done' && prev !== 'done') {
        const required = (bar.steps ?? []).filter(s => !s.optional)
        if (required.length > 0 && required.every(s => s.state === 'done')) {
            fireParticles(chipEl, bar.title)
        }
    }
    await _save()
}

async function _onBarTitleBlur(barId, newTitle) {
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar || bar.title === newTitle) return
    bar.title = newTitle
    _redrawGlobalBar()
    await _save()
}

async function _onStepTitleBlur(barId, stepId, newTitle) {
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar) return
    const step = (bar.steps ?? []).find(s => s.id === stepId)
    if (!step || step.title === newTitle) return
    step.title = newTitle
    _redrawGlobalBar()
    await _save()
}

let _notesTimer = null
function _onNotesInput(e) {
    _page.notes = e.target.value
    clearTimeout(_notesTimer)
    _notesTimer = setTimeout(_save, 800)
}

async function _addBar() {
    const bar = { id: crypto.randomUUID(), title: '', steps: [] }
    _page.bars = [...(_page.bars ?? []), bar]

    const list = _container.querySelector('[data-role="bars-list"]')
    list.appendChild(_buildBarRow(bar))
    _redrawGlobalBar()
    await _save()
}

async function _deleteBar(barId) {
    _page.bars = (_page.bars ?? []).filter(b => b.id !== barId)
    _container.querySelector(`.pb-bar-row[data-bar-id="${barId}"]`)?.remove()
    _refreshBarNums()
    _redrawGlobalBar()
    await _save()
}

async function _copyBar(sourceBarId) {
    const source = (_page.bars ?? []).find(b => b.id === sourceBarId)
    if (!source) return
    const newBar = {
        id: crypto.randomUUID(),
        title: source.title,
        optional: source.optional,
        steps: (source.steps ?? []).map(s => ({
            id: crypto.randomUUID(),
            title: s.title,
            optional: s.optional,
            state: null,
        })),
    }
    const srcIdx = _page.bars.findIndex(b => b.id === sourceBarId)
    _page.bars = [
        ..._page.bars.slice(0, srcIdx + 1),
        newBar,
        ..._page.bars.slice(srcIdx + 1),
    ]

    const list = _container.querySelector('[data-role="bars-list"]')
    const srcRow = _container.querySelector(`.pb-bar-row[data-bar-id="${sourceBarId}"]`)
    const newRow = _buildBarRow(newBar)
    srcRow ? srcRow.after(newRow) : list.appendChild(newRow)
    _refreshBarNums()
    _redrawGlobalBar()
    await _save()
}

async function _addStep(barId) {
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar) return
    const step = { id: crypto.randomUUID(), title: '', state: null }
    bar.steps = [...(bar.steps ?? []), step]

    const row = _container.querySelector(`.pb-bar-row[data-bar-id="${barId}"]`)
    if (!row) return
    const chips = row.querySelector('[data-role="chips"]')
    const addBtn = chips.querySelector('.pb-chip-add')
    const chip = _buildChip(barId, step)
    chips.insertBefore(chip, addBtn)
    _redrawGlobalBar()
    await _save()

    const label = chip.querySelector('.pb-chip-label')
    label.contentEditable = 'true'
    label.focus()
}

async function _deleteStep(barId, stepId) {
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar) return
    bar.steps = (bar.steps ?? []).filter(s => s.id !== stepId)
    _container.querySelector(`.pb-chip[data-step-id="${stepId}"]`)?.remove()
    _redrawGlobalBar()
    await _save()
}

async function _toggleBarOptional(barId) {
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar) return
    bar.optional = !bar.optional
    const row = _container.querySelector(`.pb-bar-row[data-bar-id="${barId}"]`)
    if (row) row.replaceWith(_buildBarRow(bar))
    _refreshBarNums()
    _redrawGlobalBar()
    await _save()
}

async function _toggleStepOptional(barId, stepId) {
    const bar = (_page.bars ?? []).find(b => b.id === barId)
    if (!bar) return
    const step = (bar.steps ?? []).find(s => s.id === stepId)
    if (!step) return
    step.optional = !step.optional
    const chip = _container.querySelector(`.pb-chip[data-step-id="${stepId}"]`)
    if (chip) chip.replaceWith(_buildChip(barId, step))
    _redrawGlobalBar()
    await _save()
}

// ── Page title ────────────────────────────────────────────────────────────────

function _buildPageTitle(subtitle) {
    const frag = document.createDocumentFragment()

    // Back link — only for game-specific trackers
    if (_page.appid) {
        const back = document.createElement('a')
        back.className = 'gj-sub-back'
        back.href = `/journal/${_page.appid}`
        back.textContent = '← Journal'
        back.addEventListener('click', e => { e.preventDefault(); navigate(`journal/${_page.appid}`) })
        frag.appendChild(back)
    }

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
        bars: _page.bars,
        notes: _page.notes,
    })
    if (updated) refreshSidebarItem(updated)
}
