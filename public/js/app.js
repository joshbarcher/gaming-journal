import { navigate, getRoutePath, registerRenderer, addNewPage } from './router.js'
import { renderList } from './views/list.js'
import { renderProgress } from './views/progress.js'
import { renderProgressBars } from './views/progress-bars.js'
import { renderNotes } from './views/notes.js'
import { renderPage } from './views/page.js'

registerRenderer('list', renderList)
registerRenderer('progress', renderProgress)
registerRenderer('progress-bars', renderProgressBars)
registerRenderer('notes', renderNotes)
registerRenderer('page', renderPage)

// ── Mobile sidebar toggle ──────────────────────────────────────────────────────
const toggleBtn = document.getElementById('sidebar-toggle')
const sidebarEl = document.getElementById('sidebar')
const overlayEl = document.getElementById('sidebar-overlay')

export function closeMobileSidebar() {
    sidebarEl.classList.remove('sidebar--open')
    overlayEl.classList.remove('visible')
}

toggleBtn.addEventListener('click', () => {
    const isOpen = sidebarEl.classList.toggle('sidebar--open')
    overlayEl.classList.toggle('visible', isOpen)
})

overlayEl.addEventListener('click', closeMobileSidebar)

document.addEventListener('paste', e => {
    const target = e.target
    if (!target.isContentEditable && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (target.isContentEditable) {
        document.execCommand('insertText', false, text)
    } else {
        const start = target.selectionStart
        const end   = target.selectionEnd
        target.value = target.value.slice(0, start) + text + target.value.slice(end)
        target.selectionStart = target.selectionEnd = start + text.length
    }
})

// Intercept link clicks: route internal paths through the SPA, and scroll
// in-page anchors manually (native scroll targets the window, not the
// scrollable main-content container).
document.addEventListener('click', e => {
    const a = e.target.closest('a[href]')
    if (!a) return
    const href = a.getAttribute('href')

    if (href.startsWith('#')) {
        const target = document.getElementById(href.slice(1))
        if (target) {
            e.preventDefault()
            target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        return
    }

    if (!href.startsWith('/') || href.startsWith('//')) return
    e.preventDefault()
    navigate(href.slice(1))
})

// Handle browser back/forward
window.addEventListener('popstate', () => {
    navigate(getRoutePath(), { replace: true })
})

async function init() {
    document.getElementById('sidebar-add-btn')?.addEventListener('click', addNewPage)
    await navigate(getRoutePath(), { replace: true })
}

init().catch(err => {
    console.error('App init failed', err)
    document.getElementById('main-content').innerHTML =
        `<p class="page-error">Failed to load. Is the server running?</p>`
})
