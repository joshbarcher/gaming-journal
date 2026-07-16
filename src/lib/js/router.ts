import { goto } from '$app/navigation'
import { api } from './api.js'
import { newPageDialog, showError } from './dialog.js'
import { addPageToSidebar } from './sidebar.js'

const FROM_LABELS: Record<string, string> = {
    library:        'Library',
    wishlist:       'Wishlist',
    discover:       'Discover',
    'top-games':    'Top 100',
    franchise:      'Franchise',
    franchises:     'Franchises',
    favorites:      'Favorites',
    calendar:       'Calendar',
    releases:       'Releases',
    account:        'Account',
    backlog:        'Backlog',
    'hall-of-fame': 'Hall of Fame',
    abandoned:      'Abandoned',
    history:        'History',
    'in-progress':  'In Progress',
    'my-reviews':   'My Reviews',
}

export function navigate(path: string, { replace = false } = {}): void {
    goto(path ? `/${path}` : '/', { replaceState: replace })
}

export function gameBackLabel(): string {
    const from = sessionStorage.getItem('gj_game_from')
    // hasOwn: a stored "constructor"/"toString" must not resolve through the prototype.
    return from && Object.hasOwn(FROM_LABELS, from) ? FROM_LABELS[from] : 'Library'
}

export function gameBackPath(): string {
    const from = sessionStorage.getItem('gj_game_from')
    return from && Object.hasOwn(FROM_LABELS, from) ? `/${from}` : '/library'
}

export async function addNewPage(): Promise<void> {
    const result = await newPageDialog()
    if (!result) return
    try {
        const page = await api.pages.create(result)
        addPageToSidebar(page)
        goto('/' + page.id)
    } catch (err) {
        showError(`Failed to create page: ${(err as Error).message}`)
    }
}
