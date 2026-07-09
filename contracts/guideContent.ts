// Contract for GET /relay/api/guides/{appid}/{source}/{guideId}/{slug} — a page's parsed
// ContentBlock[] tree. Confirmed against multiple real downloaded guide pages (Persona 3 Reload's
// GameFAQs/IGN guides) rather than the guides-architecture memory alone, which omits the exact
// `heading`/`list` shapes — found real `list` (`{ordered, items:[{text}]}`) and `table`
// (`{headers, rows: [[{text}]]}`) examples live to confirm both.
import { z } from 'zod'

export const TableCellSchema = z.object({
    text: z.string().optional(),
    html: z.string().optional(),
    colspan: z.number().optional(),
    rowspan: z.number().optional(),
}).nullable()

const ListItemSchema: z.ZodType<{ text: string; children?: { ordered: boolean; items: unknown[] } }> = z.lazy(() =>
    z.object({
        text: z.string(),
        children: z.object({
            ordered: z.boolean(),
            items: z.array(ListItemSchema),
        }).optional(),
    }),
)

const baseBlock = {
    paragraph: z.object({ type: z.literal('paragraph'), html: z.string() }),
    heading: z.object({ type: z.literal('heading'), level: z.number(), text: z.string() }),
    // `variant: 'jumplinks'` marks an in-page TOC — every item is a lone `#fragment`
    // anchor. Renderers lay it out as horizontal pills; other consumers treat it as a
    // plain list. Emitted only by sources that opt in (adapter exports `jumpLinks`).
    list: z.object({
        type: z.literal('list'), ordered: z.boolean().optional(),
        variant: z.literal('jumplinks').optional(), items: z.array(ListItemSchema),
    }),
    image: z.object({
        type: z.literal('image'), localSrc: z.string().nullable().optional(),
        src: z.string().optional(), alt: z.string().optional(), caption: z.string().optional(),
    }),
    table: z.object({
        type: z.literal('table'), caption: z.string().optional(),
        headers: z.array(TableCellSchema).optional(), rows: z.array(z.array(TableCellSchema)),
    }),
}

// `section` nests ContentBlock[] recursively, so the full union needs z.lazy().
export const ContentBlockSchema: z.ZodType<unknown> = z.lazy(() => z.union([
    baseBlock.paragraph, baseBlock.heading, baseBlock.list, baseBlock.image, baseBlock.table,
    z.object({
        type: z.literal('section'), level: z.number(), heading: z.string(), id: z.string(),
        children: z.array(ContentBlockSchema).optional(),
    }),
]))

export const GuideContentResponseSchema = z.array(ContentBlockSchema)
