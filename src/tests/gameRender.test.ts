import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    releaseStatus,
    fmtHours,
    fmtCount,
    fmtPlayerCount,
    scoreColor,
    newsBBCodeDirty,
    renderNewsHtml,
} from '../lib/js/views/game-render.js'

afterEach(() => {
    vi.useRealTimers()
})

const game = (store: Record<string, unknown> | null | undefined) => ({ appid: 1, name: 'G', store }) as any

// ── releaseStatus ─────────────────────────────────────────────────────────────

describe('releaseStatus', () => {
    it('returns unknown when there is no store payload', () => {
        expect(releaseStatus(game(undefined))).toBe('unknown')
        expect(releaseStatus(game(null))).toBe('unknown')
    })

    it('returns unknown for an unavailable store page even if a date exists', () => {
        expect(releaseStatus(game({ unavailable: true, releaseDate: '2020-01-01' }))).toBe('unknown')
    })

    it('early access wins over any release date', () => {
        expect(releaseStatus(game({ categories: ['Early Access'], releaseDate: '2019-05-01' }))).toBe('early_access')
    })

    it('handles missing categories (?? [] path)', () => {
        expect(releaseStatus(game({ releaseDate: '2019-05-01' }))).toBe('released')
    })

    it('returns unknown for a missing, empty, or whitespace-only date', () => {
        expect(releaseStatus(game({}))).toBe('unknown')
        expect(releaseStatus(game({ releaseDate: '' }))).toBe('unknown')
        expect(releaseStatus(game({ releaseDate: '   ' }))).toBe('unknown')
    })

    it('recognises the coming-soon keywords case-insensitively', () => {
        for (const d of ['Coming Soon', 'COMING SOON', 'To Be Announced', 'TbA', 'tbd']) {
            expect(releaseStatus(game({ releaseDate: d }))).toBe('coming_soon')
        }
    })

    it('treats quarter-form dates as coming soon, with or without a space', () => {
        expect(releaseStatus(game({ releaseDate: 'Q3 2027' }))).toBe('coming_soon')
        expect(releaseStatus(game({ releaseDate: 'q1 2026' }))).toBe('coming_soon')
        expect(releaseStatus(game({ releaseDate: 'Q42027' }))).toBe('coming_soon')
    })

    it('contract: a PAST quarter (e.g. Q1 of last year) is still reported as coming_soon', () => {
        // Defensible shortcut — the regex never compares the quarter to today.
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 6, 15))
        expect(releaseStatus(game({ releaseDate: 'Q1 2020' }))).toBe('coming_soon')
    })

    it('an invalid quarter number falls through to date parsing and comes back unknown', () => {
        expect(releaseStatus(game({ releaseDate: 'Q5 2026' }))).toBe('unknown')
    })

    it('bare-year dates compare against the current year', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 6, 15))
        expect(releaseStatus(game({ releaseDate: '2027' }))).toBe('coming_soon')
        expect(releaseStatus(game({ releaseDate: '2020' }))).toBe('released')
        // contract: the current year counts as released even in January
        expect(releaseStatus(game({ releaseDate: '2026' }))).toBe('released')
    })

    it('full dates compare against now', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 6, 15))
        expect(releaseStatus(game({ releaseDate: '2026-08-15' }))).toBe('coming_soon')
        expect(releaseStatus(game({ releaseDate: '2026-06-01' }))).toBe('released')
        expect(releaseStatus(game({ releaseDate: '17 May, 2026' }))).toBe('released')
    })

    it('returns unknown for unparseable marketing dates', () => {
        expect(releaseStatus(game({ releaseDate: 'Soon(tm)' }))).toBe('unknown')
        expect(releaseStatus(game({ releaseDate: 'When it is done' }))).toBe('unknown')
    })
})

// ── fmtHours ──────────────────────────────────────────────────────────────────

describe('fmtHours', () => {
    it('em-dash for null/undefined but "0h" for zero', () => {
        expect(fmtHours(null)).toBe('—')
        expect(fmtHours(undefined)).toBe('—')
        expect(fmtHours(0)).toBe('0h')
    })

    it('one decimal under 10h', () => {
        expect(fmtHours(9.94)).toBe('9.9h')
        expect(fmtHours(0.04)).toBe('0h')
        expect(fmtHours(1.25)).toBe('1.3h')
    })

    it('rounds to the nearest half hour between 10 and 100', () => {
        expect(fmtHours(10)).toBe('10h')
        expect(fmtHours(10.3)).toBe('10.5h')
        expect(fmtHours(10.24)).toBe('10h')
        expect(fmtHours(99.9)).toBe('100h')
    })

    it('whole hours at 100 and above', () => {
        expect(fmtHours(100)).toBe('100h')
        expect(fmtHours(100.4)).toBe('100h')
        expect(fmtHours(1234.6)).toBe('1235h')
    })

    it('contract: negative hours are formatted, not rejected', () => {
        expect(fmtHours(-5)).toBe('-5h')
    })
})

// ── fmtCount ──────────────────────────────────────────────────────────────────

describe('fmtCount', () => {
    it('nullish becomes "0"', () => {
        expect(fmtCount(null)).toBe('0')
        expect(fmtCount(undefined)).toBe('0')
    })

    it('thresholds at exactly 1K and 1M', () => {
        expect(fmtCount(999)).toBe('999')
        expect(fmtCount(1000)).toBe('1.0K')
        expect(fmtCount(1_000_000)).toBe('1.0M')
    })

    it('contract: 999,999 renders as "1000.0K", not "1.0M"', () => {
        expect(fmtCount(999_999)).toBe('1000.0K')
    })

    it('contract: negative counts pass through as plain strings', () => {
        expect(fmtCount(-42)).toBe('-42')
    })
})

// ── fmtPlayerCount ────────────────────────────────────────────────────────────

describe('fmtPlayerCount', () => {
    it('em-dash for zero AND nullish (contract: 0 players hides the count)', () => {
        expect(fmtPlayerCount(0)).toBe('—')
        expect(fmtPlayerCount(null)).toBe('—')
        expect(fmtPlayerCount(undefined)).toBe('—')
    })

    it('scales K with one decimal and M with two', () => {
        expect(fmtPlayerCount(1234)).toBe('1.2K')
        expect(fmtPlayerCount(2_500_000)).toBe('2.50M')
    })

    it('small counts render as locale numbers', () => {
        expect(fmtPlayerCount(999)).toBe('999')
    })
})

// ── scoreColor ────────────────────────────────────────────────────────────────

describe('scoreColor', () => {
    it('returns null for nullish scores', () => {
        expect(scoreColor(null)).toBeNull()
        expect(scoreColor(undefined)).toBeNull()
    })

    it('band boundaries: 75 green, 74 gold, 50 gold, 49 red', () => {
        expect(scoreColor(75)!.clr).toBe('#4caf50')
        expect(scoreColor(74)!.clr).toBe('#c9a84c')
        expect(scoreColor(50)!.clr).toBe('#c9a84c')
        expect(scoreColor(49)!.clr).toBe('#e05050')
    })

    it('contract: 0 and even negative scores fall into the red band', () => {
        expect(scoreColor(0)!.clr).toBe('#e05050')
        expect(scoreColor(-1)!.clr).toBe('#e05050')
    })
})

// ── newsBBCodeDirty ───────────────────────────────────────────────────────────

describe('newsBBCodeDirty', () => {
    it('false for nullish news, missing items, and missing contents', () => {
        expect(newsBBCodeDirty(null)).toBe(false)
        expect(newsBBCodeDirty(undefined)).toBe(false)
        expect(newsBBCodeDirty({})).toBe(false)
        expect(newsBBCodeDirty({ items: [] })).toBe(false)
        expect(newsBBCodeDirty({ items: [{}] })).toBe(false)
    })

    it('detects classic and attribute-form tags, case-insensitively', () => {
        expect(newsBBCodeDirty({ items: [{ contents: 'x [b]y[/b]' }] })).toBe(true)
        expect(newsBBCodeDirty({ items: [{ contents: '[img src="u"][/img]' }] })).toBe(true)
        expect(newsBBCodeDirty({ items: [{ contents: '[URL=x]y[/URL]' }] })).toBe(true)
    })

    it('does not flag bracketed prose that is not a known tag', () => {
        expect(newsBBCodeDirty({ items: [{ contents: '[Patch Notice] servers down' }] })).toBe(false)
        expect(newsBBCodeDirty({ items: [{ contents: '[urgent] read this' }] })).toBe(false)
    })

    it('one dirty item among many clean ones is enough', () => {
        expect(newsBBCodeDirty({ items: [{ contents: 'clean' }, { contents: '[i]x[/i]' }] })).toBe(true)
    })
})

// ── renderNewsHtml ────────────────────────────────────────────────────────────

function parse(html: string): HTMLElement {
    const div = document.createElement('div')
    div.innerHTML = html
    return div
}

describe('renderNewsHtml — basics', () => {
    it('empty-ish input renders as empty string', () => {
        expect(renderNewsHtml(null)).toBe('')
        expect(renderNewsHtml(undefined)).toBe('')
        expect(renderNewsHtml('')).toBe('')
    })

    it('rewrites STEAM_CLAN image tokens to the CDN host', () => {
        const out = renderNewsHtml('[img]{STEAM_CLAN_IMAGE}/x/y.png[/img]')
        expect(out).toContain('src="https://clan.akamai.steamstatic.com/images/x/y.png"')
        const out2 = renderNewsHtml('{STEAM_CLAN_LOC_IMAGE}/z.png')
        expect(out2).toBe('https://clan.akamai.steamstatic.com/images/z.png')
    })

    it('converts attribute-form img tags', () => {
        const out = renderNewsHtml('[img src="https://a/b.png"][/img]')
        const img = parse(out).querySelector('img')!
        expect(img.getAttribute('src')).toBe('https://a/b.png')
        expect(img.getAttribute('loading')).toBe('lazy')
    })

    it('converts classic img tags and trims whitespace in the URL', () => {
        const out = renderNewsHtml('[img]  https://a/b.png \n[/img]')
        expect(parse(out).querySelector('img')!.getAttribute('src')).toBe('https://a/b.png')
    })

    it('converts both url forms to links with noopener', () => {
        const named = parse(renderNewsHtml('[url=https://x.example]click[/url]')).querySelector('a')!
        expect(named.getAttribute('href')).toBe('https://x.example')
        expect(named.textContent).toBe('click')
        expect(named.getAttribute('rel')).toBe('noopener noreferrer')
        const bare = parse(renderNewsHtml('[url]https://y.example[/url]')).querySelector('a')!
        expect(bare.getAttribute('href')).toBe('https://y.example')
    })

    it('converts dynamiclink and previewyoutube tags', () => {
        const dl = parse(renderNewsHtml('[dynamiclink href="https://store.example/app/1"][/dynamiclink]')).querySelector('a')!
        expect(dl.getAttribute('href')).toBe('https://store.example/app/1')
        const yt = parse(renderNewsHtml('[previewyoutube=abc_-123;full][/previewyoutube]')).querySelector('a')!
        expect(yt.getAttribute('href')).toBe('https://www.youtube.com/watch?v=abc_-123')
    })

    it('maps Steam h1/h2 to h3 and h3 to h4', () => {
        expect(renderNewsHtml('[h1]A[/h1][h2]B[/h2][h3]C[/h3]')).toBe('<h3>A</h3><h3>B</h3><h4>C</h4>')
    })

    it('converts inline styling including the strike alias', () => {
        expect(renderNewsHtml('[b]a[/b][i]b[/i][u]c[/u][s]d[/s][strike]e[/strike]'))
            .toBe('<strong>a</strong><em>b</em><u>c</u><s>d</s><s>e</s>')
    })

    it('converts lists, and olist still closes as a ul', () => {
        expect(renderNewsHtml('[list][*]one[*]two[/list]')).toBe('<ul><li>one</li><li>two</li></ul>')
        expect(renderNewsHtml('[olist][*]one[/olist]')).toBe('<ul><li>one</li></ul>')
    })

    it('inline tags inside list items survive because they are converted first', () => {
        expect(renderNewsHtml('[list][*][b]bold[/b] rest[/list]'))
            .toBe('<ul><li><strong>bold</strong> rest</li></ul>')
    })

    it('contract: a literal "[" inside a list item truncates the item at the bracket', () => {
        // The [*] capture stops at any "[", so trailing bracketed text lands outside the <li>.
        const out = renderNewsHtml('[list][*]see [1] below[/list]')
        expect(out).toBe('<ul><li>see </li>[1] below</ul>')
    })

    it('converts quotes (with or without author) and code blocks', () => {
        expect(renderNewsHtml('[quote=dev]hi[/quote]')).toBe('<blockquote>hi</blockquote>')
        expect(renderNewsHtml('[quote]hi[/quote]')).toBe('<blockquote>hi</blockquote>')
        expect(renderNewsHtml('[code]x < y[/code]')).toBe('<pre>x < y</pre>')
    })

    it('strips unrendered Steam tags (spoiler, table, hr) but keeps their text', () => {
        expect(renderNewsHtml('[spoiler]secret[/spoiler]')).toBe('secret')
        expect(renderNewsHtml('[table][tr][td]cell[/td][/tr][/table]')).toBe('cell')
        expect(renderNewsHtml('a[hr][/hr]b')).toBe('ab')
    })

    it('drops the lone-backslash spacer lines Steam sprinkles in', () => {
        expect(renderNewsHtml('<p>\\</p>')).toBe('<p></p>')
        expect(renderNewsHtml('line1\n\\\nline2')).toBe('line1\n\nline2')
    })

    it('leaves unclosed tags untouched rather than corrupting the text', () => {
        expect(renderNewsHtml('[b]unclosed')).toBe('[b]unclosed')
    })
})

describe('renderNewsHtml — injection', () => {
    // BUG: game-render.ts:80-81 — the classic [img]url[/img] form interpolates the
    // captured "url" ([\s\S]*?) into a double-quoted src attribute without escaping
    // quotes, so [img]x" onerror="alert(1)[/img] becomes
    // <img src="x" onerror="alert(1)" loading="lazy"> — attribute/XSS injection when
    // the output is rendered with {@html}. Severity: HIGH (remote news content).
    it('quotes in classic [img] URLs cannot break out of the src attribute', () => {
        const out = renderNewsHtml('[img]x" onerror="window.__x=1[/img]')
        const img = parse(out).querySelector('img')!
        expect(img.getAttribute('onerror')).toBeNull()
    })

    // BUG: game-render.ts:90-91 — same unescaped interpolation for the classic
    // [url]url[/url] form: [url]x" onclick="alert(1)[/url] yields an <a> with an
    // injected onclick attribute. Severity: HIGH (same vector as the img case).
    it('quotes in classic [url] URLs cannot break out of the href attribute', () => {
        const out = renderNewsHtml('[url]x" onclick="window.__x=1[/url]')
        const a = parse(out).querySelector('a')!
        expect(a.getAttribute('onclick')).toBeNull()
    })

    it('attribute-form [img src=…] cannot smuggle extra attributes (unmatched input stays literal)', () => {
        const out = renderNewsHtml('[img src="x" onerror="alert(1)"]')
        expect(parse(out).querySelector('img')).toBeNull()
        expect(out).toContain('[img src=')
    })

    it('[url=…] URLs cannot contain quotes, so the href attribute is sealed', () => {
        const out = renderNewsHtml('[url="x" onclick="alert(1)"]text[/url]')
        const a = parse(out).querySelector('a')
        if (a) expect(a.getAttribute('onclick')).toBeNull()
    })

    it('previewyoutube ids are restricted to [\\w-] so no attribute can be injected', () => {
        const out = renderNewsHtml('[previewyoutube=abc" onclick="x;full][/previewyoutube]')
        const a = parse(out).querySelector('a')
        if (a) expect(a.getAttribute('onclick')).toBeNull()
    })

    it('contract: raw HTML in news content passes through unmodified (converter, not sanitizer)', () => {
        // Steam news contents is trusted-ish HTML from the relay; the function's stated
        // job is BBCode conversion only. Documenting so a future sanitizer change is deliberate.
        const raw = '<b>hi</b><img src="x">'
        expect(renderNewsHtml(raw)).toBe(raw)
    })
})
