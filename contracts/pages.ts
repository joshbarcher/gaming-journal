// Contract for GET /api/pages?appid={appid} — a flat array mixing tracker types (progress,
// progress-bars, counter, multi-counter) and page types (page, notes), matching
// progress-helpers.ts's loose PageLike shape. Confirmed live against Persona 3 Reload's real
// 11-page mix (progress/progress-bars/counter/multi-counter all present; no page/notes-type entry
// existed in this dataset to confirm those two variants' exact live shape, so `content` is
// modeled from the doc/source rather than a live sample — flagged, not silently assumed solid).
import { z } from 'zod'

export const TaskSchema = z.object({
    id:       z.string().optional(),
    title:    z.string().optional(),
    state:    z.string().nullable().optional(),
    optional: z.boolean().optional(),
})

export const BarSchema = z.object({
    id:       z.string().optional(),
    title:    z.string().optional(),
    optional: z.boolean().optional(),
    steps:    z.array(TaskSchema).optional(),
})

export const CounterEntrySchema = z.object({
    id:      z.string().optional(),
    name:    z.string().optional(),
    current: z.number().optional(),
    target:  z.number().optional(),
})

export const PageSchema = z.object({
    id:        z.string(),
    type:      z.enum(['progress', 'progress-bars', 'counter', 'multi-counter', 'page', 'notes', 'list']),
    title:     z.string().optional(),
    appid:     z.union([z.string(), z.number()]).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    // Tracker-type fields (only the relevant one(s) present depending on `type`)
    tasks:     z.array(TaskSchema).optional(),
    bars:      z.array(BarSchema).optional(),
    current:   z.number().optional(),
    target:    z.number().optional(),
    counters:  z.array(CounterEntrySchema).optional(),
    items:     z.array(z.object({ title: z.string().optional(), done: z.boolean().optional() })).optional(),
    // `progress`/`progress-bars` only — confirmed via trackers.md ("Only progress and
    // progress-bars have a full notes textarea"), not present on counter/multi-counter.
    notes:     z.string().optional(),
    // `counter` only, confirmed via Counter.svelte directly — "one inline line of text, no
    // textarea," per trackers.md's own callout. `multi-counter` has no notes/description at all.
    description: z.string().optional(),
    // Page-type fields
    content:   z.string().optional(),
})

export const PagesResponseSchema = z.array(PageSchema)

export type Task = z.infer<typeof TaskSchema>
export type Bar  = z.infer<typeof BarSchema>
export type CounterEntry = z.infer<typeof CounterEntrySchema>
export type Page = z.infer<typeof PageSchema>
