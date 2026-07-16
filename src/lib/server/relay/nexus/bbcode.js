// Ported verbatim from relay-server src/services/nexus/bbcode.js (docs/relay-fold-in.md §6 — byte-identical logic).
// Bridge: Nexus mod-description BBCode (with a <br /> after most lines) → semantic
// HTML, so the shared guide content-parser can turn it into ContentBlock[]. We only
// build coarse structure here (headings, lists, paragraphs, links, images); the
// parser + html-cleaner do the sanitising and normalising downstream.
//
// Nexus size scale: body default is ~3, so [size<=3] is normal text, [size=4/5] are
// sub-headings, and [size>=6] are section titles.

function safeUrl(u) {
    const v = String(u).trim();
    return /^https?:\/\//i.test(v) ? v : '';
}

// Inline BBCode → HTML. Block wrappers ([size]/[center]/[list]/…) are stripped here;
// structure is handled by the line walker below.
function inline(s) {
    return String(s)
        .replace(/\[\/?(?:center|left|right|size|list|quote)[^\]]*\]/gi, '')
        .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
        .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
        .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
        .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
        .replace(/\[color=[#\w]+\]([\s\S]*?)\[\/color\]/gi, '$1')
        .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_m, u) => { const v = safeUrl(u); return v ? `<img src="${v}" alt="">` : ''; })
        .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_m, u, t) => { const v = safeUrl(u); return v ? `<a href="${v}">${inline(t)}</a>` : inline(t); })
        .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, u) => { const v = safeUrl(u); return v ? `<a href="${v}">${v}</a>` : u; })
        .replace(/\[youtube\]([\s\S]*?)\[\/youtube\]/gi, (_m, id) => { const x = String(id).replace(/[^\w-]/g, ''); return x ? `<a href="https://youtu.be/${x}">YouTube</a>` : ''; })
        .replace(/\[\/?[a-z*][^\]]*\]/gi, '')
        .trim();
}

function renderList(body, tag) {
    const items = body.split(/\[\*\]/).slice(1).map(chunk => {
        const item = inline(chunk.replace(/\[\/\*\]/g, '').replace(/\n+/g, ' '));
        return item ? `<li>${item}</li>` : '';
    }).join('');
    return items ? `<${tag}>${items}</${tag}>` : '';
}

export function bbcodeToHtml(src) {
    if (!src) return '';
    // Line breaks → newlines; neutralise raw HTML tags but keep entities intact.
    let s = String(src).replace(/<br\s*\/?>/gi, '\n').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    s = s.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, (_m, b) => '\n' + renderList(b, 'ol') + '\n');
    s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi,   (_m, b) => '\n' + renderList(b, 'ul') + '\n');
    s = s.replace(/\[line\]/gi, '\n<hr>\n');

    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };

    for (const rawLine of s.split('\n')) {
        const line = rawLine.trim();
        if (!line) { flush(); continue; }
        if (line === '<hr>') { flush(); out.push('<hr>'); continue; }
        if (/^<(ul|ol)>/.test(line)) { flush(); out.push(line); continue; }

        // Heading: [size>=6] on its own, or a bold [size=4/5] line (a plain [size=4]
        // colour/emphasis line is body text, not a heading).
        const sizeM = line.match(/\[size=(\d+)\]/i);
        const size  = sizeM ? Number(sizeM[1]) : 0;
        if (size >= 6 || (size >= 4 && /\[b\]/i.test(line))) {
            const inner = inline(line);
            const plain = inner.replace(/<[^>]+>/g, '').trim();
            if (!inner) continue;
            flush();
            // Decorative symbol-only headers (e.g. "***") → rule, which the parser drops.
            if (!/[a-z0-9]/i.test(plain)) out.push('<hr>');
            else out.push(size >= 6 ? `<h2>${inner}</h2>` : `<h3>${inner}</h3>`);
            continue;
        }

        const html = inline(line);
        if (html) para.push(html); else flush();
    }
    flush();
    return out.join('\n');
}
