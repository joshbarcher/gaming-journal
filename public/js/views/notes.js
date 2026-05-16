import { api } from '../api.js'
import { escapeHtml } from '../utils.js'
import { refreshSidebarItem } from '../sidebar.js'

// ── Module state ──────────────────────────────────────────────────────────────

let _page = null
let _container = null

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderNotes(page, container) {
    _page = JSON.parse(JSON.stringify(page))
    _container = container
    _draw()
}

// ── Full render ───────────────────────────────────────────────────────────────

function _draw() {
    _container.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'page-header'
    header.appendChild(_buildPageTitle('(Note)'))
    _container.appendChild(header)

    const inputWrap = document.createElement('div')
    inputWrap.className = 'notes-input-wrap'

    const textarea = document.createElement('textarea')
    textarea.className = 'notes-input'
    textarea.placeholder = 'Notes…'
    textarea.setAttribute('aria-label', 'New note')
    inputWrap.appendChild(textarea)

    const hint = document.createElement('p')
    hint.className = 'notes-input-hint'
    hint.textContent = 'Ctrl + Enter to add'
    inputWrap.appendChild(hint)

    _container.appendChild(inputWrap)

    textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault()
            _addNote(textarea)
        }
    })

    const grid = document.createElement('div')
    grid.className = 'notes-grid'
    grid.dataset.role = 'notes-grid'
    _container.appendChild(grid)

    for (const note of (_page.notes ?? [])) {
        grid.appendChild(_buildCard(note))
    }
}

// ── Card ──────────────────────────────────────────────────────────────────────

function _buildCard(note) {
    const card = document.createElement('div')
    card.className = 'notes-card'
    card.dataset.id = note.id

    const text = document.createElement('p')
    text.className = 'notes-card-text'
    text.contentEditable = 'true'
    text.spellcheck = true
    text.textContent = note.text
    text.addEventListener('keydown', e => {
        if (e.key === 'Escape') { text.textContent = note.text; text.blur() }
        // Allow Ctrl+Enter as shortcut to blur
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); text.blur() }
    })
    text.addEventListener('focus', () => card.classList.add('notes-card--editing'))
    text.addEventListener('blur', async () => {
        card.classList.remove('notes-card--editing')
        const newText = text.textContent.trim()
        if (!newText) { text.textContent = note.text; return }
        if (newText === note.text) return
        note.text = newText
        await _editNote(note.id, newText)
    })
    card.appendChild(text)

    const del = document.createElement('button')
    del.className = 'notes-card-delete'
    del.innerHTML = '&times;'
    del.setAttribute('aria-label', 'Delete note')
    del.addEventListener('mousedown', e => e.preventDefault()) // prevent blur before click
    del.addEventListener('click', () => _deleteNote(note.id))
    card.appendChild(del)

    return card
}

// ── Interactions ──────────────────────────────────────────────────────────────

async function _addNote(textarea) {
    const text = textarea.value.trim()
    if (!text) return

    const note = { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }
    _page.notes = [note, ...(_page.notes ?? [])]

    const grid = _container.querySelector('[data-role="notes-grid"]')
    const card = _buildCard(note)
    grid.prepend(card)

    textarea.value = ''
    textarea.focus()

    await _save()
}

async function _editNote(noteId, newText) {
    const note = (_page.notes ?? []).find(n => n.id === noteId)
    if (!note) return
    note.text = newText
    await _save()
}

async function _deleteNote(noteId) {
    _page.notes = (_page.notes ?? []).filter(n => n.id !== noteId)
    _container.querySelector(`.notes-card[data-id="${noteId}"]`)?.remove()
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
    const updated = await api.pages.update(_page.id, { notes: _page.notes })
    if (updated) refreshSidebarItem(updated)
}
