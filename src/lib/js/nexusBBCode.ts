// Convert a NexusMods mod-description (BBCode with occasional embedded <br />)
// into safe HTML for {@html}. Raw HTML in the source is escaped FIRST, so only the
// tags we deliberately produce here can render — no <script>/<iframe> injection
// from third-party mod descriptions. URLs are restricted to http(s).

function safeUrl(u: string): string {
    const v = u.trim()
    return /^https?:\/\//i.test(v) ? v : ''
}

export function nexusBBCodeToHtml(src: string | null | undefined): string {
    if (!src) return ''
    let s = String(src)

    // Keep the explicit line breaks Nexus embeds as HTML, then neutralise all raw HTML.
    s = s.replace(/<br\s*\/?>/gi, '\n')
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    s = s
        .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
        .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
        .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
        .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
        .replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center">$1</div>')
        .replace(/\[right\]([\s\S]*?)\[\/right\]/gi, '<div style="text-align:right">$1</div>')
        .replace(/\[left\]([\s\S]*?)\[\/left\]/gi, '<div style="text-align:left">$1</div>')
        .replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>')
        .replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<pre>$1</pre>')
        .replace(/\[color=([#\w]+)\]([\s\S]*?)\[\/color\]/gi,
            (_m, c, t) => `<span style="color:${/^#?[\w]+$/.test(c) ? c : 'inherit'}">${t}</span>`)
        .replace(/\[size=(\d+)\]([\s\S]*?)\[\/size\]/gi,
            (_m, n, t) => `<span style="font-size:${Math.min(26, Math.max(11, 9 + Number(n) * 2))}px">${t}</span>`)
        .replace(/\[img\]([\s\S]*?)\[\/img\]/gi,
            (_m, u) => { const v = safeUrl(u); return v ? `<img src="${v}" alt="" loading="lazy" style="max-width:100%;height:auto">` : '' })
        .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi,
            (_m, u, t) => { const v = safeUrl(u); return v ? `<a href="${v}" target="_blank" rel="noopener nofollow">${t}</a>` : t })
        .replace(/\[url\]([\s\S]*?)\[\/url\]/gi,
            (_m, u) => { const v = safeUrl(u); return v ? `<a href="${v}" target="_blank" rel="noopener nofollow">${v}</a>` : u })
        .replace(/\[youtube\]([\s\S]*?)\[\/youtube\]/gi,
            (_m, id) => { const safe = String(id).replace(/[^\w-]/g, ''); return safe ? `<a href="https://youtu.be/${safe}" target="_blank" rel="noopener">▶ YouTube</a>` : '' })
        .replace(/\[line\]/gi, '<hr>')
        .replace(/\[\/?list[^\]]*\]/gi, '')
        .replace(/\[\*\]\s*/gi, '\n• ')
        .replace(/\[\/\*\]/gi, '')              // closing list-item tag
        .replace(/\[\/?[a-z*][^\]]*\]/gi, '')   // strip any remaining/unknown BBCode

    // Paragraphs + line breaks
    s = s.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')
    return `<p>${s}</p>`
}
