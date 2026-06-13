import type { Page } from '$lib/types.js'

export function uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
}

export function localDateStr(d: string | number | Date): string {
    const date = (typeof d === 'string' || typeof d === 'number') ? new Date(d) : d
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function escapeHtml(str: unknown): string {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

export function progressPercent(page: Page): number {
    if (page.type === 'progress') {
        const required = (page.tasks ?? []).filter(t => !t.optional)
        if (!required.length) return 0
        const done = required.filter(t => t.state === 'done').length
        return Math.round((done / required.length) * 100)
    }
    if (page.type === 'progress-bars') {
        const requiredSteps = (page.bars ?? [])
            .filter(b => !b.optional)
            .flatMap(b => (b.steps ?? []).filter(s => !s.optional))
        if (!requiredSteps.length) return 0
        const done = requiredSteps.filter(s => s.state === 'done').length
        return Math.round((done / requiredSteps.length) * 100)
    }
    if (page.type === 'list') {
        if (!page.items?.length) return 0
        const done = page.items.filter(i => i.done).length
        return Math.round((done / page.items.length) * 100)
    }
    return 0
}

export function isSuperComplete(page: Page): boolean {
    if (page.type === 'progress') {
        const optional = (page.tasks ?? []).filter(t => t.optional)
        return optional.length > 0 && optional.every(t => t.state === 'done')
    }
    if (page.type === 'progress-bars') {
        const optionalBars  = (page.bars ?? []).filter(b => b.optional)
        const optionalSteps = (page.bars ?? []).filter(b => !b.optional)
            .flatMap(b => (b.steps ?? []).filter(s => s.optional))
        const total = optionalBars.length + optionalSteps.length
        if (!total) return false
        const barsComplete  = optionalBars.every(b => (b.steps ?? []).every(s => s.state === 'done'))
        const stepsComplete = optionalSteps.every(s => s.state === 'done')
        return barsComplete && stepsComplete
    }
    return false
}

export const TYPE_ORDER = ['list', 'progress', 'progress-bars', 'notes', 'page', 'counter', 'multi-counter']

export const TYPE_LABELS: Record<string, string> = {
    list:             'Lists',
    progress:         'Progress',
    'progress-bars':  'Progress (Multi)',
    notes:            'Notes',
    page:             'Pages',
}

export function groupPagesByType(pages: Page[]): { type: string; label: string; pages: Page[] }[] {
    const map: Record<string, Page[]> = {}
    for (const page of pages) {
        if (!map[page.type]) map[page.type] = []
        map[page.type].push(page)
    }
    return TYPE_ORDER
        .filter(type => map[type]?.length)
        .map(type => ({ type, label: TYPE_LABELS[type] ?? type, pages: map[type] }))
}
