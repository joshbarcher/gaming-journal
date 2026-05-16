export const STATE_COLORS = {
    done:    '#4ecdc4',
    working: '#c9a84c',
    started: '#7ab8f5',
}

const DIM = 'rgba(255,255,255,0.10)'

export function segmentColor(state) {
    return STATE_COLORS[state] ?? DIM
}

export function barProgressPercent(bar) {
    const steps = (bar.steps ?? []).filter(s => !s.optional)
    if (!steps.length) return 0
    const done = steps.filter(s => s.state === 'done').length
    return Math.round((done / steps.length) * 100)
}

export function percentToColor(pct) {
    if (pct >= 100) return STATE_COLORS.done
    if (pct >= 50)  return STATE_COLORS.working
    if (pct > 0)    return STATE_COLORS.started
    return DIM
}

const STATE_DISPLAY = { started: 'Started', working: 'Working', done: 'Done' }

export function stateLabel(state) {
    return STATE_DISPLAY[state] ?? ''
}

export function percentToStateLabel(pct) {
    if (pct >= 100) return 'Done'
    if (pct >= 50)  return 'Working'
    if (pct > 0)    return 'Started'
    return ''
}

export function heatmapRows(pages) {
    return pages
        .filter(p => p.type === 'progress' || p.type === 'progress-bars' || p.type === 'list')
        .map(p => ({ id: p.id, title: p.title, cells: globalSegments(p) }))
}

export function globalSegments(page) {
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
    return []
}
