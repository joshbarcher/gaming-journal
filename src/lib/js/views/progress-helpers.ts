import type { Page, Bar, Segment } from '$lib/types.js'

export const STATE_COLORS: Record<string, string> = {
    done:    '#4ecdc4',
    working: '#c9a84c',
    started: '#7ab8f5',
}

const DIM = 'rgba(255,255,255,0.10)'

export function segmentColor(state: string | null): string {
    return (state ? STATE_COLORS[state] : null) ?? DIM
}

export function barProgressPercent(bar: Bar): number {
    const steps = (bar.steps ?? []).filter(s => !s.optional)
    if (!steps.length) return 0
    const done = steps.filter(s => s.state === 'done').length
    return Math.round((done / steps.length) * 100)
}

export function percentToColor(pct: number): string {
    if (pct >= 100) return STATE_COLORS.done
    if (pct >= 50)  return STATE_COLORS.working
    if (pct > 0)    return STATE_COLORS.started
    return DIM
}

const STATE_DISPLAY: Record<string, string> = { started: 'Started', working: 'Working', done: 'Done' }

export function stateLabel(state: string | null): string {
    return (state ? STATE_DISPLAY[state] : null) ?? ''
}

export function percentToStateLabel(pct: number): string {
    if (pct >= 100) return 'Done'
    if (pct >= 50)  return 'Working'
    if (pct > 0)    return 'Started'
    return ''
}

export function heatmapRows(pages: Page[]): { id: string; title: string; cells: Segment[] }[] {
    return pages
        .filter(p => p.type === 'progress' || p.type === 'progress-bars' || p.type === 'list')
        .map(p => ({ id: p.id, title: p.title, cells: globalSegments(p) }))
}

export function globalSegments(page: Page): Segment[] {
    if (page.type === 'progress') {
        return (page.tasks ?? []).map((t, i) => ({
            num:        i + 1,
            color:      segmentColor(t.state),
            label:      t.title,
            stateLabel: stateLabel(t.state),
            optional:   !!t.optional,
            done:       t.state === 'done',
        }))
    }
    if (page.type === 'progress-bars') {
        return (page.bars ?? []).map((b, i) => {
            const pct = barProgressPercent(b)
            return {
                num:        i + 1,
                color:      percentToColor(pct),
                label:      b.title,
                stateLabel: percentToStateLabel(pct),
                optional:   !!b.optional,
                done:       pct >= 100,
            }
        })
    }
    if (page.type === 'list') {
        return (page.items ?? []).map((item, i) => ({
            num:        i + 1,
            color:      item.done ? STATE_COLORS.done : DIM,
            label:      item.title,
            stateLabel: item.done ? 'Done' : '',
            optional:   false,
            done:       !!item.done,
        }))
    }
    if (page.type === 'counter') {
        const target  = page.target  ?? 0
        const current = page.current ?? 0
        const pct     = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0
        return [{
            num:        1,
            color:      percentToColor(pct),
            label:      page.title,
            stateLabel: percentToStateLabel(pct),
            optional:   false,
            done:       pct >= 100,
        }]
    }
    if (page.type === 'multi-counter') {
        return (page.counters ?? []).map((c, i) => {
            const target  = c.target  ?? 0
            const current = c.current ?? 0
            const pct     = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0
            return {
                num:        i + 1,
                color:      percentToColor(pct),
                label:      c.name ?? `Counter ${i + 1}`,
                stateLabel: percentToStateLabel(pct),
                optional:   false,
                done:       pct >= 100,
            }
        })
    }
    return []
}

export function pagePct(page: Page): number {
    if (page.type === 'progress') {
        const tasks = page.tasks ?? []
        if (!tasks.length) return 0
        return Math.round(tasks.filter(t => t.state === 'done').length / tasks.length * 100)
    }
    if (page.type === 'progress-bars') {
        const bars = page.bars ?? []
        let done = 0, total = 0
        for (const b of bars) {
            const steps = (b.steps ?? []).filter(s => !s.optional)
            done  += steps.filter(s => s.state === 'done').length
            total += steps.length
        }
        return total > 0 ? Math.round(done / total * 100) : 0
    }
    if (page.type === 'counter') {
        const target = page.target ?? 0
        return target > 0 ? Math.min(100, Math.round((page.current ?? 0) / target * 100)) : 0
    }
    if (page.type === 'multi-counter') {
        const counters   = page.counters ?? []
        const totalT     = counters.reduce((s, c) => s + (c.target  ?? 0), 0)
        const totalC     = counters.reduce((s, c) => s + (c.current ?? 0), 0)
        return totalT > 0 ? Math.min(100, Math.round(totalC / totalT * 100)) : 0
    }
    return 0
}
