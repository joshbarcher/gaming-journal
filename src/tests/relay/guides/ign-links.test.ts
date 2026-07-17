// @ts-nocheck — the adapter under test is untyped .js; assertions are runtime-verified by vitest.
// Covers IGN's rewriteInternalLinks: classify each /wikis/ cross-reference into an
// in-guide link, a rescued near-miss slug, or a de-linked keyword. Guards the two
// bugs behind "empty pages": dead cross-refs (page never fetched) and near-miss
// slugs the old prefix matcher couldn't resolve.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { rewriteInternalLinks } from '../../../lib/server/relay/guides/ign/adapter.js';

const WIKI = 'persona-3-reload';

// A realistic slice of the P3R guide's fetched pages.
const known = new Set([
    'thebel-tartarus-walkthrough',
    'arqa-floors-23-43-tartarus-walkthrough',
    'arqa-floors-44-69-tartarus-walkthrough',
    'final-mission-the-promised-day-january-31',
    'tziah-floors-119-144-tartarus-walkthrough',
    'tartarus-walkthrough',
    'boss-guides',
    'the-hermit-boss-guide',
    'the-lovers-boss-guide',
]);

const wikiLink = (page, text) => `<a href="/wikis/${WIKI}/${page}">${text}</a>`;
const href = html => html.match(/href="([^"]*)"/)?.[1];

// ── In-guide links ────────────────────────────────────────────────────────────

describe('ign rewriteInternalLinks — in-guide links', () => {
    it('maps a wiki page to its bare filesystem slug', () => {
        const out = rewriteInternalLinks(wikiLink('Thebel_-_Tartarus_Walkthrough', 'Thebel'), WIKI, known);
        assert.equal(href(out), 'thebel-tartarus-walkthrough');
        assert.ok(!out.includes('gv-keyword'));
    });

    it('preserves and slugifies a fragment on an in-guide link', () => {
        const out = rewriteInternalLinks(wikiLink('Thebel_-_Tartarus_Walkthrough#The_Boss_Fight', 'x'), WIKI, known);
        assert.equal(href(out), 'thebel-tartarus-walkthrough#the-boss-fight');
    });

    it('points a bare wiki-root link at the guide landing (#)', () => {
        assert.equal(href(rewriteInternalLinks(`<a href="/wikis/${WIKI}">Home</a>`, WIKI, known)), '#');
        assert.equal(href(rewriteInternalLinks(`<a href="/wikis/${WIKI}/">Home</a>`, WIKI, known)), '#');
    });

    it('relativises and resolves an absolute ign.com URL', () => {
        const out = rewriteInternalLinks(`<a href="https://www.ign.com/wikis/${WIKI}/Boss_Guides">Bosses</a>`, WIKI, known);
        assert.equal(href(out), 'boss-guides');
    });

    it('drops IGN\'s "slate/" draft namespace so a link resolves to the published page', () => {
        // /wikis/{slug}/slate/{Page} is an editorial draft mirror of a real page.
        const out = rewriteInternalLinks(wikiLink('slate/Tziah_(Floors_119_-_144)_Tartarus_Walkthrough', 'Tziah'), WIKI, known);
        assert.equal(href(out), 'tziah-floors-119-144-tartarus-walkthrough');
    });

    it('leaves fragment-only jump links untouched', () => {
        const html = '<a href="#the-tower">The Tower</a>';
        assert.equal(rewriteInternalLinks(html, WIKI, known), html);
    });

    it('is a no-op on HTML with no wiki links', () => {
        const html = '<strong>Goro Akechi</strong> joins here.';
        assert.equal(rewriteInternalLinks(html, WIKI, known), html);
    });
});

// ── Near-miss resolution ──────────────────────────────────────────────────────

describe('ign rewriteInternalLinks — near-miss slug resolution', () => {
    it('rescues a link whose title is a subset of the page title', () => {
        // "Final Mission January 31" links to "…the Promised Day (January 31)".
        const out = rewriteInternalLinks(wikiLink('Final_Mission_January_31', 'Final Mission'), WIKI, known);
        assert.equal(href(out), 'final-mission-the-promised-day-january-31');
    });

    it('rescues a link carrying a junk prefix the page slug lacks', () => {
        // A stray "Slate:" template prefix — page tokens are a subset of the link's.
        const out = rewriteInternalLinks(wikiLink('Slate_Tziah_(Floors_119_-_144)_-_Tartarus_Walkthrough', 'Tziah'), WIKI, known);
        assert.equal(href(out), 'tziah-floors-119-144-tartarus-walkthrough');
    });
});

// ── Dead / ambiguous cross-references → de-linked keyword ──────────────────────

describe('ign rewriteInternalLinks — dead links become keywords', () => {
    it('de-links a cross-reference to a page that was never fetched', () => {
        // The reported bug: June links to "Arqa (Part 2)", which IGN renamed away.
        const out = rewriteInternalLinks(wikiLink('Arqa_(Part_2)_-_Tartarus_Walkthrough', 'Arqa (Part 2) guide'), WIKI, known);
        assert.equal(out, '<span class="gv-keyword">Arqa (Part 2) guide</span>');
        assert.ok(!out.includes('<a'));
    });

    it('will not fold a specific link into a generic hub page on a shared suffix', () => {
        // "arqa-part-2-tartarus-walkthrough" shares "-tartarus-walkthrough" with the
        // hub page "tartarus-walkthrough" — that overlap must NOT resolve the link.
        const out = rewriteInternalLinks(wikiLink('Arqa_(Part_2)_-_Tartarus_Walkthrough', 'x'), WIKI, known);
        assert.ok(!out.includes('tartarus-walkthrough'));
        assert.ok(out.includes('gv-keyword'));
    });

    it('de-links an ambiguous title that matches two pages equally', () => {
        // "Boss Guide" is a subset of both hermit and lovers boss guides — ambiguous.
        const out = rewriteInternalLinks(wikiLink('Boss_Guide', 'a boss guide'), WIKI, known);
        assert.equal(out, '<span class="gv-keyword">a boss guide</span>');
    });

    it('de-links a cross-wiki link that points off this guide', () => {
        const out = rewriteInternalLinks('<a href="/wikis/persona-5-royal/Confidants">Confidants</a>', WIKI, known);
        assert.equal(out, '<span class="gv-keyword">Confidants</span>');
    });

    it('preserves inline markup inside a de-linked anchor', () => {
        const out = rewriteInternalLinks(wikiLink('Gone_Page', 'the <strong>best</strong> build'), WIKI, known);
        assert.equal(out, '<span class="gv-keyword">the <strong>best</strong> build</span>');
    });

    it('keeps an in-guide link while de-linking a dead one in the same block', () => {
        const out = rewriteInternalLinks(
            `See ${wikiLink('Thebel_-_Tartarus_Walkthrough', 'Thebel')} and ${wikiLink('Arqa_(Part_2)_-_Tartarus_Walkthrough', 'Arqa 2')}.`,
            WIKI, known,
        );
        assert.equal(out, 'See <a href="thebel-tartarus-walkthrough">Thebel</a> and <span class="gv-keyword">Arqa 2</span>.');
    });

    it('returns inline HTML, not a wrapped document', () => {
        const out = rewriteInternalLinks(`RELATED: ${wikiLink('Gone', 'x')}`, WIKI, known);
        assert.ok(!/<html>|<body>/.test(out));
        assert.ok(out.startsWith('RELATED: '));
    });
});
