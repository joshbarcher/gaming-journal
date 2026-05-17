import { escapeHtml } from '../utils.js'

export async function renderSettings(container) {
    container.innerHTML = `<p class="page-loading">Loading settings…</p>`

    let settings
    try {
        const res = await fetch('/api/settings')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        settings = await res.json()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load settings: ${escapeHtml(err.message)}</p>`
        return
    }

    _render(container, settings)
}

function _render(container, settings) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Settings</h1>
        </div>
        <div class="settings-body">
            <section class="settings-section">
                <h2 class="settings-section-title">Content Filters</h2>
                <p class="settings-section-desc">
                    Games flagged as Child Lock or Filtered are hidden from all lists by default.
                    Toggle these on to reveal them.
                </p>
                ${_toggle('showChildLocked', 'Show Child Locked Games',
                    'Reveal games flagged with the child lock in library, wishlist, and all other lists.',
                    settings.showChildLocked)}
                ${_toggle('showFiltered', 'Show Filtered Games',
                    'Reveal games flagged as filtered (political themes, personal preference, etc.).',
                    settings.showFiltered)}
            </section>
        </div>`

    container.querySelectorAll('.settings-toggle-row').forEach(row => {
        const input = row.querySelector('input[type="checkbox"]')
        input.addEventListener('change', async () => {
            const key = input.dataset.key
            const val = input.checked
            // Optimistic — checkbox already reflects new state
            try {
                const res = await fetch('/api/settings', {
                    method:  'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ [key]: val }),
                })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
            } catch {
                // Revert
                input.checked = !val
            }
        })
    })
}

function _toggle(key, label, desc, checked) {
    return `
        <label class="settings-toggle-row">
            <div class="settings-toggle-text">
                <span class="settings-toggle-label">${escapeHtml(label)}</span>
                <span class="settings-toggle-desc">${escapeHtml(desc)}</span>
            </div>
            <div class="settings-toggle-switch">
                <input type="checkbox" data-key="${key}" ${checked ? 'checked' : ''}>
                <span class="settings-toggle-track"></span>
            </div>
        </label>`
}
