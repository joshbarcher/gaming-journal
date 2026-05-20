import { escapeHtml } from '../utils.js'

export async function renderSettings(container) {
    container.innerHTML = `<p class="page-loading">Loading settings…</p>`

    let settings, flagCounts
    try {
        const [settingsRes, flagsRes] = await Promise.all([
            fetch('/api/settings'),
            fetch('/api/flags').catch(() => null),
        ])
        if (!settingsRes.ok) throw new Error(`HTTP ${settingsRes.status}`)
        settings = await settingsRes.json()

        const flags = flagsRes?.ok ? await flagsRes.json() : {}
        const entries = Object.values(flags)
        flagCounts = {
            childLocked: entries.filter(f => f?.childLock).length,
            filtered:    entries.filter(f => f?.filtered).length,
        }
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load settings: ${escapeHtml(err.message)}</p>`
        return
    }

    _render(container, settings, flagCounts)
}

function _render(container, settings, flagCounts = {}) {
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
                    settings.showChildLocked, flagCounts.childLocked)}
                ${_toggle('showFiltered', 'Show Filtered Games',
                    'Reveal games flagged as filtered (political themes, personal preference, etc.).',
                    settings.showFiltered, flagCounts.filtered)}
            </section>
            <section class="settings-section">
                <h2 class="settings-section-title">Wishlist</h2>
                ${_toggle('hideUnavailable', 'Show Unavailable Games',
                    'Show wishlist items that are no longer available on the Steam store.',
                    !settings.hideUnavailable)}
            </section>
        </div>`

    container.querySelectorAll('.settings-toggle-row').forEach(row => {
        const input = row.querySelector('input[type="checkbox"]')
        input.addEventListener('change', async () => {
            const key = input.dataset.key
            const val = input.checked
            // hideUnavailable is stored inverted relative to the toggle
            // (toggle ON = show unavailable = hideUnavailable: false)
            const apiVal = key === 'hideUnavailable' ? !val : val
            // Optimistic — checkbox already reflects new state
            try {
                const res = await fetch('/api/settings', {
                    method:  'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ [key]: apiVal }),
                })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
            } catch {
                // Revert
                input.checked = !val
            }
        })
    })
}

function _toggle(key, label, desc, checked, count) {
    const countBadge = count > 0
        ? `<span class="settings-filter-count">${count} game${count === 1 ? '' : 's'}</span>`
        : ''
    return `
        <label class="settings-toggle-row" data-key="${key}">
            <div class="settings-toggle-text">
                <span class="settings-toggle-label">${escapeHtml(label)}${countBadge}</span>
                <span class="settings-toggle-desc">${escapeHtml(desc)}</span>
            </div>
            <div class="settings-toggle-switch">
                <input type="checkbox" data-key="${key}" ${checked ? 'checked' : ''}>
                <span class="settings-toggle-track"></span>
            </div>
        </label>`
}

