// A "structured block editor" data model for PageEditor.svelte's `type: 'page'` content — NOT a
// port of its contenteditable + document.execCommand() rich-text mechanism, which has no RN
// equivalent (no contenteditable, no execCommand, no browser Selection/Range API on native). Per
// the TODO item's own explicit instruction ("structured block editor, no contenteditable"), this
// is a genuinely different, simpler editing model: content is a flat array of typed blocks (each
// backed by a plain TextInput), serialized to/from the same HTML `content` string field the web
// app already persists, so existing pages remain readable and new saves stay format-compatible.
//
// Real-data-informed simplification, not guessed: read an actual saved page's content (a Resident
// Evil Village achievement-location guide) and found it's just a single <p> with <br><br> line
// breaks and literal "**bold**" markdown-style asterisks as plain text — not real nested <b>/<i>
// tags. Inline rich formatting (bold/italic/underline/font-size/font-family) is dropped entirely
// as the expected cost of no-contenteditable, not silently lost — the toolbar for those simply
// doesn't exist here.
export type PageBlock =
    | { id: string; type: 'paragraph'; text: string }
    | { id: string; type: 'heading'; text: string }
    | { id: string; type: 'listItem'; text: string }

let blockIdCounter = 0
function newBlockId() {
    blockIdCounter += 1
    return `blk-${Date.now()}-${blockIdCounter}`
}

function decodeEntities(s: string): string {
    return s
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
}

function stripInlineTags(s: string): string {
    return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
}

export function parseBlocksFromHtml(html: string | null | undefined): PageBlock[] {
    if (!html || !html.trim()) return []
    const blocks: PageBlock[] = []
    // Matches <p>...</p>, <h1-6>...</h6>, and <li>...</li> (list items, wherever nested) in
    // document order — a pragmatic regex pass rather than a full HTML parser (no DOM available on
    // native to parse with), sufficient for this app's real content shapes.
    const blockRe = /<(p|h[1-6]|li)[^>]*>([\s\S]*?)<\/\1>/gi
    let match: RegExpExecArray | null
    while ((match = blockRe.exec(html))) {
        const tag = match[1].toLowerCase()
        const text = decodeEntities(stripInlineTags(match[2])).trim()
        if (!text) continue
        if (tag === 'li') blocks.push({ id: newBlockId(), type: 'listItem', text })
        else if (tag === 'p') blocks.push({ id: newBlockId(), type: 'paragraph', text })
        else blocks.push({ id: newBlockId(), type: 'heading', text })
    }
    if (!blocks.length) {
        // No recognized block tags at all — treat the whole thing as one plain paragraph rather
        // than silently discarding content the parser didn't understand.
        const text = decodeEntities(stripInlineTags(html)).trim()
        if (text) blocks.push({ id: newBlockId(), type: 'paragraph', text })
    }
    return blocks
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function serializeBlocksToHtml(blocks: PageBlock[]): string {
    return blocks.map(b => {
        const escaped = escapeHtml(b.text).replace(/\n/g, '<br>')
        if (b.type === 'heading') return `<h2>${escaped}</h2>`
        if (b.type === 'listItem') return `<ul><li>${escaped}</li></ul>`
        return `<p>${escaped}</p>`
    }).join('')
}

export function newBlock(type: PageBlock['type']): PageBlock {
    return { id: newBlockId(), type, text: '' }
}
