// Contract for GET /api/journal-notes/{appid} — the sticky-note wall's raw note list. Only the
// dashboard's count/preview needs are modeled here (the full interactive corkboard is Phase 5 per
// PLAN.md — "highest-risk single feature, no RN equivalent exists").
import { z } from 'zod'

export const StickyNoteSchema = z.object({
    id:       z.string(),
    label:    z.string().optional(),
    message:  z.string().optional(),
    from:     z.string().optional(),
    size:     z.string().optional(),
    color:    z.string().optional(),
    rotation: z.number().optional(),
})

export const JournalNotesResponseSchema = z.array(StickyNoteSchema)

export type StickyNote = z.infer<typeof StickyNoteSchema>
