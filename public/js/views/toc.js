import { escapeHtml, groupPagesByType } from '../utils.js'

export function renderToc(pages, container) {
    const groups = groupPagesByType(pages)

    const body = groups.length === 0
        ? `<p class="toc-empty">No pages yet — use "+ New Page" to get started.</p>`
        : groups.map(g => buildSection(g)).join('')

    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Table of Contents</h1>
            <p class="page-subtitle">(Quicklinks)</p>
        </div>
        <div class="toc-body">${body}</div>`
}

function buildSection({ label, pages }) {
    const items = pages.map(p => {
        const href = `#${p.id}`
        return `<li><a class="toc-link" href="${href}">${escapeHtml(p.title)}</a></li>`
    }).join('')

    return `
        <div class="toc-section">
            <h2 class="toc-section-title">${escapeHtml(label)}</h2>
            <ul class="toc-list">${items}</ul>
        </div>`
}
