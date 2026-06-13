import type { Page } from '$lib/types.js'
import { store } from '$lib/sidebar.svelte.js'

export function refreshAlertsBadge(): void {
    fetch('/api/alerts')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) store.alertsCount = data.onSale?.length ?? 0 })
        .catch(() => {})
}

export function refreshSidebarItem(updatedPage: Page): void {
    const idx = store.pages.findIndex(p => p.id === updatedPage.id)
    if (idx !== -1) store.pages[idx] = updatedPage
}

export function addPageToSidebar(page: Page): void {
    store.pages.push(page)
}
