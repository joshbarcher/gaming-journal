/**
 * Minimal BBCode → HTML converter for Steam community announcement content.
 *
 * Steam's BBCode subset is predictable — this handles everything that appears
 * in practice without a full parser. Detection is done before conversion so
 * content that's already HTML passes through untouched.
 *
 * Conversion order matters: more-specific attribute forms must come before
 * bare forms. A final cleanup sweep strips any tags that weren't recognised
 * so nothing leaks through to the rendered output.
 */

// ── Detection ─────────────────────────────────────────────────────────────────

const BBCODE_RE = /\[(?:h[123]|b|i|u|p|url|img|list|olist|quote|strike|spoiler|previewyoutube|hr|code|table|\*)[=\]\s]/i;

export function isBBCode(text) {
    return BBCODE_RE.test(text);
}

// ── Steam token expansion ──────────────────────────────────────────────────────

const STEAM_CLAN_IMAGE = 'https://clan.akamai.steamstatic.com/images/';

function expandSteamTokens(text) {
    return text.replace(/\{STEAM_CLAN_IMAGE\}/g, STEAM_CLAN_IMAGE);
}

// ── Conversion ────────────────────────────────────────────────────────────────

export function bbcodeToHtml(text) {
    if (!text) return '';

    // Expand Steam CDN tokens regardless of content type.
    text = expandSteamTokens(text);

    if (!isBBCode(text)) return text;

    let h = text;

    // Headings + paragraph
    h = h.replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h1>$1</h1>');
    h = h.replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h2>$1</h2>');
    h = h.replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h3>$1</h3>');
    h = h.replace(/\[p\]([\s\S]*?)\[\/p\]/gi,   '<p>$1</p>');
    h = h.replace(/\[hr\]/gi,                    '<hr>');

    // Links — attribute form first, then bare
    h = h.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>');
    h = h.replace(/\[url\]([\s\S]*?)\[\/url\]/gi,           '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // Images — most-specific attribute forms first
    h = h.replace(/\[img\s+width=(\d+)\s+height=(\d+)\]([\s\S]*?)\[\/img\]/gi, '<img src="$3" width="$1" height="$2" loading="lazy">');
    h = h.replace(/\[img\s+src="([^"]+)"\]([\s\S]*?)\[\/img\]/gi,              '<img src="$1" loading="lazy">');
    h = h.replace(/\[img\]([\s\S]*?)\[\/img\]/gi,                               '<img src="$1" loading="lazy">');

    // YouTube preview → plain link (no embedding)
    h = h.replace(/\[previewyoutube=([^;]+);[^\]]*\]/gi, '<a href="https://www.youtube.com/watch?v=$1" target="_blank" rel="noopener noreferrer">&#9654; Watch on YouTube</a>');

    // Inline styles
    h = h.replace(/\[b\]([\s\S]*?)\[\/b\]/gi,             '<strong>$1</strong>');
    h = h.replace(/\[i\]([\s\S]*?)\[\/i\]/gi,             '<em>$1</em>');
    h = h.replace(/\[u\]([\s\S]*?)\[\/u\]/gi,             '<u>$1</u>');
    h = h.replace(/\[strike\]([\s\S]*?)\[\/strike\]/gi,   '<s>$1</s>');
    h = h.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<details><summary>Spoiler</summary><div>$1</div></details>');
    h = h.replace(/\[code\]([\s\S]*?)\[\/code\]/gi,       '<code>$1</code>');
    h = h.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi,     '<blockquote>$1</blockquote>');

    // Lists — [/*] is an explicit close variant some developers use; include it
    // in the lookahead so it ends the item cleanly rather than leaking through.
    h = h.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_, inner) =>
        '<ul>' + inner.replace(/\[\*\]([\s\S]*?)(?=\[\*\]|\[\/\*\]|\[\/list\]|$)/gi,
            (__, item) => `<li>${item.trim()}</li>`) + '</ul>'
    );
    h = h.replace(/\[olist\]([\s\S]*?)\[\/olist\]/gi, (_, inner) =>
        '<ol>' + inner.replace(/\[\*\]([\s\S]*?)(?=\[\*\]|\[\/\*\]|\[\/olist\]|$)/gi,
            (__, item) => `<li>${item.trim()}</li>`) + '</ol>'
    );

    // Table (basic passthrough)
    h = h.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, '<table>$1</table>');
    h = h.replace(/\[tr\]([\s\S]*?)\[\/tr\]/gi,       '<tr>$1</tr>');
    h = h.replace(/\[th\]([\s\S]*?)\[\/th\]/gi,       '<th>$1</th>');
    h = h.replace(/\[td\]([\s\S]*?)\[\/td\]/gi,       '<td>$1</td>');

    // Final cleanup — strip any tags that weren't recognised above so they
    // never leak into the rendered output. Matches:
    //   [/word...]  closing tags
    //   [word...]   opening / self-closing tags with any attributes
    //   [*]         bare list-item markers outside a [list] block
    //   [/*]        explicit list-item close (non-word char after /)
    h = h.replace(/\[(?:\*|\/\*|\/?\w)[^\]]*\]/g, '');

    // Newlines: double → paragraph break, single → <br>
    h = h.replace(/\n{2,}/g, '</p><p>');
    h = h.replace(/\n/g,     '<br>');

    // Wrap bare text in <p> if no block elements were produced
    if (!/<(?:p|h[123]|ul|ol|blockquote|table|hr)[\s>]/i.test(h)) {
        h = `<p>${h}</p>`;
    }

    return h;
}
