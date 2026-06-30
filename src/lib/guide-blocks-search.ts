/**
 * Extracts searchable text entries from a parsed guide page's blocks array.
 * Each entry carries the blockPath needed to scroll to that element — the same
 * child-index path that GuideViewer's scrollToBlockPath resolves against
 * .gv-content-inner.
 *
 * Mirrors the DOM layout that GuideBlockRenderer produces:
 *   section block at index i  → <div.gv-section> at DOM child[i]
 *     heading                 → DOM child[0] inside the section div
 *     children[j]             → DOM child[j+1] inside the section div
 *   paragraph/list/etc at i   → single element at DOM child[i]
 */

export interface PageEntry {
    text:      string
    blockPath: number[]
}

const STRIP_HTML    = /<[^>]+>/g
const NORM_SPACES   = /\s+/g

function stripHtml(s: string): string {
    return (s ?? '').replace(STRIP_HTML, ' ').replace(NORM_SPACES, ' ').trim()
}

function flattenListText(items: any[]): string {
    return items.flatMap(item => {
        const parts = [stripHtml(item.text ?? '')]
        if (item.children?.items?.length) parts.push(flattenListText(item.children.items))
        return parts
    }).filter(Boolean).join(' ')
}

function extractBlock(block: any, path: number[], out: PageEntry[]): void {
    switch (block.type) {
        case 'section': {
            // The section renders as <div.gv-section>; its heading is DOM child[0],
            // and its children[] map to DOM child[1], child[2], ...
            const heading = block.heading ?? ''
            if (heading) out.push({ text: heading, blockPath: [...path, 0] })
            const children: any[] = block.children ?? []
            for (let j = 0; j < children.length; j++) {
                extractBlock(children[j], [...path, j + 1], out)
            }
            break
        }
        case 'heading': {
            // Standalone heading block (not inside a section) → single element
            const text = block.text ?? block.heading ?? ''
            if (text) out.push({ text, blockPath: path })
            break
        }
        case 'paragraph': {
            const text = stripHtml(block.html ?? '')
            if (text.length > 10) out.push({ text, blockPath: path })
            break
        }
        case 'list': {
            // All items concatenated into one entry pointing to the list element
            const text = flattenListText(block.items ?? [])
            if (text.length > 3) out.push({ text, blockPath: path })
            break
        }
        case 'image': {
            const text = [block.caption, block.alt].filter(Boolean).join(' ')
            if (text) out.push({ text, blockPath: path })
            break
        }
        case 'table': {
            const allCells: any[] = [
                ...(block.headers ?? []),
                ...(block.rows ?? []).flat(),
            ]
            const text = allCells
                .map((c: any) => stripHtml(c?.html ?? c?.text ?? ''))
                .filter(Boolean)
                .join(' · ')
            if (text) out.push({ text, blockPath: path })
            break
        }
    }
}

export function extractPageEntries(blocks: any[]): PageEntry[] {
    const out: PageEntry[] = []
    for (let i = 0; i < blocks.length; i++) {
        extractBlock(blocks[i], [i], out)
    }
    return out
}
