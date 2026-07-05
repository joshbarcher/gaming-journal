// Ported from the vendor lib's own constants/logic (src/lib/js/vendor/stickywall.js) — read
// directly rather than trusting PLAN.md's prior description. **Major correction**: PLAN.md
// called this "the highest-risk single feature, no RN equivalent exists," assuming a freeform
// x/y-position drag corkboard needing a custom Pan+Reanimated transform primitive. The real
// vendor lib has NO x/y position field on a note at all — it's a `display:flex; flex-wrap:wrap`
// grid of note cards with a small COSMETIC rotation (a fixed per-index value from the ROTATIONS
// array below, not user-adjustable), and "draggable" means HTML5 drag-and-drop LIST REORDERING
// (insert-before/after a target), not a free 2D transform. This is a fundamentally simpler
// feature than PLAN.md assumed — see the Notes screen's own file-level comment for how this
// changes the RN build.
export const NOTE_COLORS: Record<string, string> = {
    yellow: '#3b3808',
    green:  '#0d3020',
    pink:   '#3a1030',
    blue:   '#0e2040',
    purple: '#1e1042',
    red:    '#3a1010',
}
export const NOTE_COLOR_KEYS = Object.keys(NOTE_COLORS)
export const NOTE_TEXT_COLOR = '#d8d4c8'
export const NOTE_FROM_COLOR = '#9a9478'

export const NOTE_SIZE_WIDTH: Record<string, number> = { sm: 160, md: 220, lg: 300 }

// Ported verbatim — cycles by note index, same as `#pickColor`/`#normalize`'s
// `ROTATIONS[idx % ROTATIONS.length]`.
export const ROTATIONS = [-5, 2, -2, 5, 1, -3, 4, 0, -4, 3, -1, -5, 2, -2, 5]

export function pickColor(idx: number): string {
    return NOTE_COLOR_KEYS[idx % NOTE_COLOR_KEYS.length]
}

export function pickRotation(idx: number): number {
    return ROTATIONS[idx % ROTATIONS.length]
}

export function genNoteId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
