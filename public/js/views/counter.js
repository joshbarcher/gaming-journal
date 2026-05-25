import { api } from '../api.js'
import { escapeHtml } from '../utils.js'
import { refreshSidebarItem } from '../sidebar.js'
import { navigate } from '../router.js'
import { percentToColor } from './progress-helpers.js'

let _page      = null
let _container = null
let _saveTimer = null

export function renderCounter(page, container) {
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

    if (_page.appid) {
        const back = document.createElement('a')
        back.className  = 'gj-sub-back'
        back.href       = `/journal/${_page.appid}`
        back.textContent = '← Journal'
        back.addEventListener('click', e => { e.preventDefault(); navigate(`journal/${_page.appid}`) })
        header.appendChild(back)
    }

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
    sub.className  = 'page-subtitle'
    sub.textContent = 'Counter'
    header.appendChild(sub)
    _container.appendChild(header)

    // Counter UI
    const wrap = document.createElement('div')
    wrap.className = 'counter-wrap'
    wrap.innerHTML = `
        <div class="counter-display">
            <button class="counter-btn counter-btn--dec" data-role="dec" aria-label="Decrease">−</button>
            <div class="counter-value-wrap">
                <span class="counter-current" data-role="current">${_page.current ?? 0}</span>
                <span class="counter-sep">/</span>
                <span class="counter-target" contenteditable="true" data-role="target"
                      title="Click to edit target" spellcheck="false">${_page.target ?? '?'}</span>
            </div>
            <button class="counter-btn counter-btn--inc" data-role="inc" aria-label="Increase">+</button>
        </div>
        <div class="counter-track-wrap">
            <div class="counter-track-fill" data-role="pct-bar"
                 style="width:${_pct()}%; background:${percentToColor(_pct())}"></div>
        </div>
        <p class="counter-pct-label" data-role="pct-label">${_pct()}% complete</p>`
    _container.appendChild(wrap)

    wrap.querySelector('[data-role="dec"]').addEventListener('click', () => _adjust(-1))
    wrap.querySelector('[data-role="inc"]').addEventListener('click', () => _adjust(1))

    const targetEl = wrap.querySelector('[data-role="target"]')
    targetEl.addEventListener('blur', async () => {
        const val = parseInt(targetEl.textContent.trim(), 10)
        if (!isNaN(val) && val > 0) {
            _page.target = val
            _updateDisplay()
            await _save()
        } else {
            targetEl.textContent = _page.target ?? '?'
        }
    })
    targetEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); targetEl.blur() }
    })
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _pct() {
    const target = _page.target ?? 0
    return target > 0 ? Math.min(100, Math.round((_page.current ?? 0) / target * 100)) : 0
}

function _updateDisplay() {
    const pct    = _pct()
    const currEl = _container.querySelector('[data-role="current"]')
    const barEl  = _container.querySelector('[data-role="pct-bar"]')
    const lblEl  = _container.querySelector('[data-role="pct-label"]')
    if (currEl) currEl.textContent  = _page.current ?? 0
    if (barEl)  { barEl.style.width = `${pct}%`; barEl.style.background = percentToColor(pct) }
    if (lblEl)  lblEl.textContent   = `${pct}% complete`
}

async function _adjust(delta) {
    _page.current = Math.max(0, (_page.current ?? 0) + delta)
    _updateDisplay()
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(_save, 400)
}

async function _save() {
    const updated = await api.pages.update(_page.id, {
        current: _page.current,
        target:  _page.target,
    })
    if (updated) refreshSidebarItem(updated)
}
