/**
 * Decode HTML character entities in a plain-text string.
 *
 * Single-pass replace: each `&…;` is matched and substituted exactly once, so
 * double-escaped input decodes correctly (`&amp;quot;` → `&quot;`, not `"`).
 * Handles the common named entities plus decimal (`&#39;`) and hex (`&#x27;`)
 * numeric references. Intended for text that is rendered AS TEXT (e.g. Steam
 * `short_description`), not for HTML that is rendered via `{@html}` — decoding
 * entities inside real HTML would turn escaped markup into live tags.
 *
 * Several ingest paths already had their own private copies of this (scraped
 * reviews, achievement schema, guide jump-links); this is the shared version.
 */

const NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    nbsp: ' ', ndash: '–', mdash: '—',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    hellip: '…', trade: '™', reg: '®', copy: '©',
    deg: '°', middot: '·', bull: '•',
};

/** @param {string | null | undefined} str */
export function decodeEntities(str) {
    if (!str) return str;
    return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
        if (body[0] === '#') {
            const cp = body[1] === 'x' || body[1] === 'X'
                ? parseInt(body.slice(2), 16)
                : parseInt(body.slice(1), 10);
            return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
        }
        const named = NAMED[body.toLowerCase()];
        return named !== undefined ? named : whole;
    });
}
