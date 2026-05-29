import { api } from '../api.js'
import { confirmDialog } from '../dialog.js'
import { escapeHtml, uuid } from '../utils.js'
import { refreshSidebarItem } from '../sidebar.js'
import { navigate } from '../router.js'
import { percentToColor } from './progress-helpers.js'

let _page      = null
let _container = null
let _saveTimer = null

export function renderMultiCounter(page, container) {
    _page      = JSON.parse(JSON.stringify(page))
    _container = container
    _draw()
}

// ── Render ─────────────────────────────────────────────────────────────────────

function _draw() {
    _container.innerHTML = ''

    // Header
    const header = document.createElement('div')
    header.className = 'page-header'

    // Top row: back link (left) + delete (right)
    const topRow = document.createElement('div')
    topRow.style.cssText = 'display:flex;align-items:center;margin-bottom:8px'

    if (_page.appid) {
        const back = document.createElement('a')
        back.className   = 'gj-sub-back'
        back.href        = `/journal/${_page.appid}`
        back.textContent = '← Journal'
        back.addEventListener('click', e => { e.preventDefault(); navigate(`journal/${_page.appid}`) })
        topRow.appendChild(back)
    }

    const delBtn = document.createElement('button')
    delBtn.className   = 'gj-btn gj-btn--danger'
    delBtn.textContent = 'Delete'
    delBtn.style.marginLeft = 'auto'
    delBtn.addEventListener('click', async () => {
        const ok = await confirmDialog(
            `Delete "${_page.title}"?`,
            'This will permanently delete the multi-counter and all its data.',
            'Delete'
        )
        if (!ok) return
        await api.pages.remove(_page.id)
        if (_page.appid) navigate(`journal/${_page.appid}`)
    })
    topRow.appendChild(delBtn)
    header.appendChild(topRow)

    const h1 = document.createElement('h1')
    h1.className       = 'page-title page-title--editable'
    h1.contentEditable = 'true'
    h1.textContent     = _page.title
    h1.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); h1.blur() } })
    h1.addEventListener('blur', async () => {
        const t = h1.textContent.trim()
        if (!t || t === _page.title) { h1.textContent = _page.title; return }
        _page.title = t
        const updated = await api.pages.update(_page.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    })
    header.appendChild(h1)

    const sub = document.createElement('p')
    sub.className   = 'page-subtitle'
    sub.textContent = 'Multi-Counter'
    header.appendChild(sub)
    _container.appendChild(header)

    // Global aggregate bar
    const globalBar = document.createElement('div')
    globalBar.className  = 'mcounter-global'
    globalBar.dataset.role = 'global-bar'
    _container.appendChild(globalBar)
    _redrawGlobal()

    // Counter rows
    const list = document.createElement('div')
    list.className    = 'mcounter-list'
    list.dataset.role = 'counter-list'
    for (const c of (_page.counters ?? [])) {
        list.appendChild(_buildRow(c))
    }
    _container.appendChild(list)

    // Add button
    const addBtn = document.createElement('button')
    addBtn.className   = 'progress-add-btn'
    addBtn.textContent = '+ Add Counter'
    addBtn.addEventListener('click', _addCounter)
    _container.appendChild(addBtn)
}

// ── Global bar ─────────────────────────────────────────────────────────────────

function _redrawGlobal() {
    const el = _container.querySelector('[data-role="global-bar"]')
    if (!el) return
    const counters = _page.counters ?? []
    const totalC   = counters.reduce((s, c) => s + (c.current ?? 0), 0)
    const totalT   = counters.reduce((s, c) => s + (c.target  ?? 0), 0)
    const pct      = totalT > 0 ? Math.min(100, Math.round(totalC / totalT * 100)) : 0
    const color    = percentToColor(pct)
    el.innerHTML = `
        <div class="mcounter-global-fill" style="width:${pct}%; background:${color}"></div>
        <span class="mcounter-global-label">${totalC} / ${totalT} · ${pct}%</span>`
}

// ── Counter row ────────────────────────────────────────────────────────────────

function _buildRow(c) {
    const el = document.createElement('div')
    el.className  = 'mcounter-row'
    el.dataset.id = c.id

    const pct   = _rowPct(c)
    const color = percentToColor(pct)

    el.innerHTML = `
        <div class="mcounter-row-body">
            <span class="mcounter-name" contenteditable="true" data-role="name"
                  spellcheck="false">${escapeHtml(c.name ?? '')}</span>
            <span class="mcounter-val">
                <span data-role="current">${c.current ?? 0}</span>
                <span class="counter-sep">/</span>
                <span class="mcounter-target" contenteditable="true" data-role="target"
                      title="Click to edit target" spellcheck="false">${c.target ?? '?'}</span>
            </span>
        </div>
        <div class="mcounter-bar-row">
            <button class="counter-btn counter-btn--sm counter-btn--dec" data-role="dec" aria-label="Decrease">−</button>
            <div class="mcounter-bar-wrap">
                <div class="mcounter-bar-fill" data-role="bar"
                     style="width:${pct}%; background:${color}"></div>
            </div>
            <button class="counter-btn counter-btn--sm counter-btn--inc" data-role="inc" aria-label="Increase">+</button>
        </div>`

    el.querySelector('[data-role="dec"]').addEventListener('click', () => _adjustRow(c.id, -1))
    el.querySelector('[data-role="inc"]').addEventListener('click', () => _adjustRow(c.id, 1))

    _initBarDrag(el.querySelector('.mcounter-bar-wrap'), c)

    const nameEl = el.querySelector('[data-role="name"]')
    nameEl.addEventListener('blur', async () => {
        const v = nameEl.textContent.trim()
        if (!v) { nameEl.textContent = c.name ?? ''; return }
        c.name = v
        await _save()
    })
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur() } })

    const targetEl = el.querySelector('[data-role="target"]')
    targetEl.addEventListener('blur', async () => {
        const val = parseInt(targetEl.textContent.trim(), 10)
        if (!isNaN(val) && val >= 0) {
            c.target = val
            _refreshRow(c)
            _redrawGlobal()
            await _save()
        } else {
            targetEl.textContent = c.target ?? '?'
        }
    })
    targetEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); targetEl.blur() } })

    // Right-click to delete
    el.addEventListener('contextmenu', e => {
        e.preventDefault()
        if (!confirm(`Delete "${c.name ?? 'this counter'}"?`)) return
        _page.counters = (_page.counters ?? []).filter(x => x.id !== c.id)
        el.remove()
        _redrawGlobal()
        _save()
    })

    return el
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _rowPct(c) {
    const target = c.target ?? 0
    return target > 0 ? Math.min(100, Math.round((c.current ?? 0) / target * 100)) : 0
}

function _refreshRow(counter) {
    const el = _container.querySelector(`.mcounter-row[data-id="${counter.id}"]`)
    if (!el) return
    const pct   = _rowPct(counter)
    const color = percentToColor(pct)
    const currEl = el.querySelector('[data-role="current"]')
    const barEl  = el.querySelector('[data-role="bar"]')
    if (currEl) currEl.textContent  = counter.current ?? 0
    if (barEl)  { barEl.style.width = `${pct}%`; barEl.style.background = color }
}

async function _adjustRow(id, delta) {
    const c = (_page.counters ?? []).find(x => x.id === id)
    if (!c) return
    c.current = Math.max(0, (c.current ?? 0) + delta)
    _refreshRow(c)
    _redrawGlobal()
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(_save, 400)
}

async function _addCounter() {
    const c = { id: uuid(), name: 'New Counter', current: 0, target: 10 }
    _page.counters = [...(_page.counters ?? []), c]
    const list = _container.querySelector('[data-role="counter-list"]')
    const el   = _buildRow(c)
    list.appendChild(el)
    el.querySelector('[data-role="name"]').focus()
    _redrawGlobal()
    await _save()
}

function _valueFromX(wrapEl, clientX, target) {
    const rect = wrapEl.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(pct * (target ?? 0))
}

function _initBarDrag(wrapEl, c) {
    function setLive(val) {
        c.current = Math.max(0, Math.min(val, c.target ?? val))
        _refreshRow(c)
        _redrawGlobal()
    }

    wrapEl.addEventListener('mousedown', e => {
        e.preventDefault()
        setLive(_valueFromX(wrapEl, e.clientX, c.target))

        const onMove = e => setLive(_valueFromX(wrapEl, e.clientX, c.target))
        const onUp   = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup',   onUp)
            clearTimeout(_saveTimer)
            _saveTimer = setTimeout(_save, 400)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup',   onUp)
    })

    wrapEl.addEventListener('touchstart', e => {
        e.preventDefault()
        setLive(_valueFromX(wrapEl, e.touches[0].clientX, c.target))

        const onMove = e => { e.preventDefault(); setLive(_valueFromX(wrapEl, e.touches[0].clientX, c.target)) }
        const onEnd  = () => {
            wrapEl.removeEventListener('touchmove', onMove)
            wrapEl.removeEventListener('touchend',  onEnd)
            clearTimeout(_saveTimer)
            _saveTimer = setTimeout(_save, 400)
        }
        wrapEl.addEventListener('touchmove', onMove, { passive: false })
        wrapEl.addEventListener('touchend',  onEnd)
    }, { passive: false })
}

async function _save() {
    const updated = await api.pages.update(_page.id, { counters: _page.counters })
    if (updated) refreshSidebarItem(updated)
}
