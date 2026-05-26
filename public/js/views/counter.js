import { api } from '../api.js'
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
        back.className   = 'gj-sub-back'
        back.href        = `/journal/${_page.appid}`
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
        const bigTitle = _container.querySelector('[data-role="big-title"]')
        if (bigTitle) bigTitle.textContent = t
        const updated = await api.pages.update(_page.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    })
    header.appendChild(h1)

    const sub = document.createElement('p')
    sub.className   = 'page-subtitle'
    sub.textContent = 'Counter'
    header.appendChild(sub)
    _container.appendChild(header)

    // Bar
    const wrap = document.createElement('div')
    wrap.className = 'counter-wrap'
    wrap.innerHTML = `
        <div class="counter-big-title" data-role="big-title">${_page.title}</div>
        <div class="counter-bar-outer">
            <button class="counter-btn counter-btn--dec" data-role="dec" aria-label="Decrease">−</button>
            <div class="counter-track-wrap" data-role="track">
                <div class="counter-track-fill" data-role="pct-bar"
                     style="width:${_pct()}%; background:${percentToColor(_pct())}"></div>
                <span class="counter-overlay-val">
                    <span data-role="current">${_page.current ?? 0}</span><span class="counter-overlay-sep"> / </span><span
                          class="counter-overlay-target" contenteditable="true" data-role="target"
                          title="Click to edit target" spellcheck="false">${_page.target ?? '?'}</span>
                </span>
                <span class="counter-overlay-pct" data-role="pct-label">${_pct()}%</span>
            </div>
            <button class="counter-btn counter-btn--inc" data-role="inc" aria-label="Increase">+</button>
        </div>`
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
        e.stopPropagation()
    })

    _initBarInteraction(wrap.querySelector('[data-role="track"]'))
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
    if (currEl) currEl.textContent = _page.current ?? 0
    if (barEl)  { barEl.style.width = `${pct}%`; barEl.style.background = percentToColor(pct) }
    if (lblEl)  lblEl.textContent   = `${pct}%`
}

function _valueFromX(trackEl, clientX) {
    const rect = trackEl.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(pct * (_page.target ?? 0))
}

// ── Bar click / drag ───────────────────────────────────────────────────────────

function _initBarInteraction(trackEl) {
    function setLive(val) {
        _page.current = Math.max(0, Math.min(val, _page.target ?? val))
        _updateDisplay()
    }

    // Mouse
    trackEl.addEventListener('mousedown', e => {
        if (e.target.closest('[data-role="target"]')) return   // let edit through
        e.preventDefault()
        setLive(_valueFromX(trackEl, e.clientX))

        const onMove = e => setLive(_valueFromX(trackEl, e.clientX))
        const onUp   = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup',   onUp)
            _saveNow()
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup',   onUp)
    })

    // Touch
    trackEl.addEventListener('touchstart', e => {
        if (e.target.closest('[data-role="target"]')) return
        e.preventDefault()
        setLive(_valueFromX(trackEl, e.touches[0].clientX))

        const onMove = e => { e.preventDefault(); setLive(_valueFromX(trackEl, e.touches[0].clientX)) }
        const onEnd  = () => {
            trackEl.removeEventListener('touchmove', onMove)
            trackEl.removeEventListener('touchend',  onEnd)
            _saveNow()
        }
        trackEl.addEventListener('touchmove', onMove, { passive: false })
        trackEl.addEventListener('touchend',  onEnd)
    }, { passive: false })
}

async function _adjust(delta) {
    _page.current = Math.max(0, (_page.current ?? 0) + delta)
    _updateDisplay()
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(_save, 400)
}

async function _saveNow() {
    clearTimeout(_saveTimer)
    await _save()
}

async function _save() {
    const updated = await api.pages.update(_page.id, {
        current: _page.current,
        target:  _page.target,
    })
    if (updated) refreshSidebarItem(updated)
}
