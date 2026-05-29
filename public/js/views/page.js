import { api } from '../api.js'
import { escapeHtml } from '../utils.js'
import { refreshSidebarItem } from '../sidebar.js'
import { parseListItems, applyIndent, renderListItems } from './page-helpers.js'

const TOGGLE_CMDS = [
    { cmd: 'bold',      label: 'B', title: 'Bold (Ctrl+B)' },
    { cmd: 'italic',    label: 'I', title: 'Italic (Ctrl+I)' },
    { cmd: 'underline', label: 'U', title: 'Underline (Ctrl+U)' },
]

const FONT_SIZES = [
    { label: 'Small',  value: '2' },
    { label: 'Normal', value: '3' },
    { label: 'Large',  value: '5' },
    { label: 'XL',     value: '7' },
]

const FONT_FAMILIES = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana']

// ── Module state ──────────────────────────────────────────────────────────────

let _page      = null
let _container = null
let _editor    = null
let _toolbar   = null
let _saveTimer = null
let _selListener = null

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderPage(page, container) {
    if (_selListener) document.removeEventListener('selectionchange', _selListener)

    _page      = JSON.parse(JSON.stringify(page))
    _container = container
    _draw()
}

// ── Full render ───────────────────────────────────────────────────────────────

function _draw() {
    _container.innerHTML = ''

    if (_page.appid) {
        const back = document.createElement('a')
        back.className = 'gj-sub-back'
        back.href = `/journal/${_page.appid}/pages`
        back.textContent = '← Journal Pages'
        _container.appendChild(back)
    }

    const header = document.createElement('div')
    header.className = 'page-header'
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
    header.appendChild(h1)
    const subtitle = document.createElement('p')
    subtitle.className = 'page-subtitle'
    subtitle.textContent = 'Page · Rich Text'
    header.appendChild(subtitle)
    _container.appendChild(header)

    _toolbar = _buildToolbar()
    _container.appendChild(_toolbar)

    _editor = document.createElement('div')
    _editor.className = 'rt-editor'
    _editor.contentEditable = 'true'
    _editor.innerHTML = _page.content || '<p><br></p>'
    _container.appendChild(_editor)

    _editor.addEventListener('input', _onInput)
    _editor.addEventListener('keydown', _onKeydown)

    _selListener = _onSelectionChange
    document.addEventListener('selectionchange', _selListener)
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function _buildToolbar() {
    const bar = document.createElement('div')
    bar.className = 'rt-toolbar'

    // B / I / U
    for (const { cmd, label, title } of TOGGLE_CMDS) {
        const btn = document.createElement('button')
        btn.className = 'rt-btn'
        btn.dataset.cmd = cmd
        btn.textContent = label
        btn.title = title
        btn.addEventListener('mousedown', e => {
            e.preventDefault()
            document.execCommand(cmd, false)
            _updateToolbarState()
        })
        bar.appendChild(btn)
    }

    bar.appendChild(_sep())

    // Bullet list
    const listBtn = document.createElement('button')
    listBtn.className = 'rt-btn'
    listBtn.dataset.cmd = 'insertUnorderedList'
    listBtn.title = 'Bullet list (Tab/Shift+Tab to indent)'
    listBtn.innerHTML = '&#8226; List'
    listBtn.addEventListener('mousedown', e => {
        e.preventDefault()
        document.execCommand('insertUnorderedList', false)
        _updateToolbarState()
    })
    bar.appendChild(listBtn)

    bar.appendChild(_sep())

    // Font size
    const sizeLabel = document.createElement('span')
    sizeLabel.className = 'rt-toolbar-label'
    sizeLabel.textContent = 'Size'
    bar.appendChild(sizeLabel)

    const sizeSelect = document.createElement('select')
    sizeSelect.className = 'rt-select'
    sizeSelect.title = 'Font size'
    for (const { label, value } of FONT_SIZES) {
        const opt = document.createElement('option')
        opt.value = value
        opt.textContent = label
        sizeSelect.appendChild(opt)
    }
    sizeSelect.value = '3'
    sizeSelect.addEventListener('mousedown', e => e.stopPropagation())
    sizeSelect.addEventListener('change', () => {
        document.execCommand('fontSize', false, sizeSelect.value)
        _editor.focus()
    })
    bar.appendChild(sizeSelect)

    bar.appendChild(_sep())

    // Font family
    const fontLabel = document.createElement('span')
    fontLabel.className = 'rt-toolbar-label'
    fontLabel.textContent = 'Font'
    bar.appendChild(fontLabel)

    const fontSelect = document.createElement('select')
    fontSelect.className = 'rt-select rt-select--font'
    fontSelect.title = 'Font family'
    for (const font of FONT_FAMILIES) {
        const opt = document.createElement('option')
        opt.value = font
        opt.textContent = font
        opt.style.fontFamily = font
        fontSelect.appendChild(opt)
    }
    fontSelect.addEventListener('mousedown', e => e.stopPropagation())
    fontSelect.addEventListener('change', () => {
        document.execCommand('fontName', false, fontSelect.value)
        _editor.focus()
    })
    bar.appendChild(fontSelect)

    return bar
}

function _sep() {
    const s = document.createElement('div')
    s.className = 'rt-sep'
    return s
}

function _updateToolbarState() {
    if (!_toolbar) return
    for (const { cmd } of TOGGLE_CMDS) {
        const btn = _toolbar.querySelector(`[data-cmd="${cmd}"]`)
        if (btn) btn.classList.toggle('active', document.queryCommandState(cmd))
    }
    const listBtn = _toolbar.querySelector('[data-cmd="insertUnorderedList"]')
    if (listBtn) listBtn.classList.toggle('active', document.queryCommandState('insertUnorderedList'))
}

// ── Event handlers ────────────────────────────────────────────────────────────

function _onSelectionChange() {
    if (!document.activeElement || !_editor?.contains(document.activeElement) &&
        document.activeElement !== _editor) return
    _updateToolbarState()
}

function _onInput() {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(_save, 600)
}

function _onKeydown(e) {
    // Auto-list: typing "- " or "* " at start of a line creates a bullet list
    if (e.key === ' ') {
        const sel = window.getSelection()
        if (sel?.rangeCount) {
            const range = sel.getRangeAt(0)
            if (range.collapsed) {
                const node = range.startContainer
                if (node.nodeType === 3) {
                    const textBefore = node.textContent.slice(0, range.startOffset)
                    if (textBefore === '-' || textBefore === '*') {
                        e.preventDefault()
                        document.execCommand('selectAll', false)
                        // Only select the current line's text node
                        const r2 = document.createRange()
                        r2.setStart(node, 0)
                        r2.setEnd(node, range.startOffset)
                        sel.removeAllRanges()
                        sel.addRange(r2)
                        document.execCommand('delete', false)
                        document.execCommand('insertUnorderedList', false)
                        return
                    }
                }
            }
        }
    }

    // Tab / Shift+Tab: indent/outdent inside a list
    if (e.key === 'Tab') {
        const list = _containingList()
        if (list) {
            e.preventDefault()
            _handleListIndent(list, e.shiftKey)
        }
    }
}

// ── List indent/outdent (ported from static-pages/canvas.js) ─────────────────

function _containingList() {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return null
    let node = sel.getRangeAt(0).startContainer
    while (node && node !== _editor) {
        if (node.tagName === 'UL' || node.tagName === 'OL') return node
        node = node.parentElement
    }
    return null
}

function _handleListIndent(list, outdent) {
    const sel = window.getSelection()
    if (!sel.rangeCount) return

    const range  = sel.getRangeAt(0)
    const allLis = Array.from(list.querySelectorAll('li'))

    const liOf = node => {
        const el = node.nodeType === 3 ? node.parentElement : node
        return el.closest('li')
    }

    const startIdx = allLis.indexOf(liOf(range.startContainer))
    if (startIdx === -1) return

    let endIdx = startIdx
    if (!range.collapsed) {
        const endLi  = liOf(range.endContainer)
        const endPos = allLis.indexOf(endLi)
        if (endPos > startIdx) endIdx = endPos
    }

    const tag     = list.tagName.toLowerCase()
    const items   = parseListItems(list)
    const updated = applyIndent(items, startIdx, endIdx, outdent)
    list.innerHTML = renderListItems(updated, tag)

    // Restore selection by index
    const newLis = Array.from(list.querySelectorAll('li'))
    const first  = newLis[Math.min(startIdx, newLis.length - 1)]
    const last   = newLis[Math.min(endIdx,   newLis.length - 1)]
    if (first) {
        const r = document.createRange()
        r.setStart(first, 0)
        r.setEnd(last, last.childNodes.length)
        sel.removeAllRanges()
        sel.addRange(r)
    }

    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(_save, 600)
}

// ── Persist ───────────────────────────────────────────────────────────────────

async function _save() {
    const content = _editor.innerHTML
    if (content === _page.content) return
    _page.content = content
    await api.pages.update(_page.id, { content })
}
