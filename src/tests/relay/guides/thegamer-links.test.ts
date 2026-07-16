// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/thegamer-links.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { preprocessRawHtml, rewriteInternalLinks } from '../../../lib/server/relay/guides/thegamer/adapter.js';

const GUIDE = 'persona-5-royal-complete-guide-walkthrough';
const known = new Set(['persona-5-royal-kamoshidas-palace-guide-walkthrough', 'persona-5-royal-complete-confidant-gift-guide']);

const href = html => html.match(/href="([^"]*)"/)?.[1];

// ── preprocessRawHtml: absolute → root-relative ───────────────────────────────
//
// html-cleaner strips any anchor with a URI scheme as "external", and that runs
// before rewriteInternalLinks can classify it. Relativizing first is what keeps
// the anchor alive long enough to be classified.

describe('thegamer preprocessRawHtml — link normalisation', () => {
    it('relativizes absolute thegamer.com article hrefs', () => {
        const out = preprocessRawHtml('<a href="https://www.thegamer.com/foo-guide/">x</a>', GUIDE);
        assert.equal(href(out), '/foo-guide/');
    });

    it('relativizes the www-less and http forms too', () => {
        assert.equal(href(preprocessRawHtml('<a href="http://thegamer.com/foo/">x</a>', GUIDE)), '/foo/');
    });

    it('preserves fragments', () => {
        const out = preprocessRawHtml('<a href="https://www.thegamer.com/foo/#the-tower">x</a>', GUIDE);
        assert.equal(href(out), '/foo/#the-tower');
    });

    it('leaves other hosts alone', () => {
        const out = preprocessRawHtml('<a href="https://example.com/foo/">x</a>', GUIDE);
        assert.equal(href(out), 'https://example.com/foo/');
    });

    it('does not touch image srcs on the CDN host', () => {
        const html = '<img src="https://static0.thegamerimages.com/a/file.jpg">';
        assert.equal(preprocessRawHtml(html, GUIDE), html);
    });
});

// ── rewriteInternalLinks: classify root-relative links ────────────────────────

describe('thegamer rewriteInternalLinks — classification', () => {
    it('maps an in-guide page to a bare slug', () => {
        const out = rewriteInternalLinks('<a href="/persona-5-royal-complete-confidant-gift-guide/">x</a>', GUIDE, known);
        assert.equal(href(out), 'persona-5-royal-complete-confidant-gift-guide');
        assert.ok(!out.includes('gv-link-external'));
    });

    it('preserves a fragment on an in-guide link', () => {
        const out = rewriteInternalLinks('<a href="/persona-5-royal-kamoshidas-palace-guide-walkthrough/#the-tower">x</a>', GUIDE, known);
        assert.equal(href(out), 'persona-5-royal-kamoshidas-palace-guide-walkthrough#the-tower');
    });

    it('strips the anchor from a RELATED target outside the guide, keeping its text as a keyword', () => {
        // The guide is not built to lead elsewhere. What is left outbound after the
        // related-article BFS is a deleted article or an off-topic listicle. It stays
        // emphasised — a keyword in the prose — rather than becoming a dead link.
        const out = rewriteInternalLinks('RELATED: <a href="/persona-5-how-to-recover-sp/">Recover SP</a>', GUIDE, known);
        assert.equal(out, 'RELATED: <span class="gv-keyword">Recover SP</span>');
        assert.ok(!out.includes('<a'));
    });

    it('strips multi-segment paths like /author/… rather than leaving them root-relative', () => {
        // Left as "/author/x/" the SPA would route to a page that does not exist.
        assert.equal(
            rewriteInternalLinks('<a href="/author/quinton-oconnor/">Quinton</a>', GUIDE, known),
            '<span class="gv-keyword">Quinton</span>',
        );
    });

    it('preserves inline markup inside a stripped anchor', () => {
        const out = rewriteInternalLinks('See <a href="/gone-article/">the <strong>best</strong> build</a>.', GUIDE, known);
        assert.equal(out, 'See <span class="gv-keyword">the <strong>best</strong> build</span>.');
    });

    it('never emits gv-link-external or a surviving href for thegamer', () => {
        const out = rewriteInternalLinks('<a href="/some-other-article/">x</a><a href="/tag/persona-5/">y</a>', GUIDE, known);
        assert.ok(!out.includes('gv-link-external'));
        assert.ok(!out.includes('href'));
        assert.equal((out.match(/gv-keyword/g) ?? []).length, 2);
    });

    it('leaves fragment-only jump links untouched', () => {
        const html = '<a href="#the-tower">The Tower</a>';
        assert.equal(rewriteInternalLinks(html, GUIDE, known), html);
    });

    it('returns inline HTML, not a wrapped document', () => {
        // cheerio's document mode would inject <html><head><body> into every block.
        const out = rewriteInternalLinks('RELATED: <a href="/author/x/">x</a>', GUIDE, known);
        assert.ok(!/<html>|<body>/.test(out));
        assert.ok(out.startsWith('RELATED: '));
    });

    it('leaves an in-guide link intact while stripping an outbound one in the same block', () => {
        const out = rewriteInternalLinks(
            'See <a href="/persona-5-royal-complete-confidant-gift-guide/">gifts</a> and <a href="/gone/">gone</a>.',
            GUIDE, known,
        );
        assert.equal(out, 'See <a href="persona-5-royal-complete-confidant-gift-guide">gifts</a> and <span class="gv-keyword">gone</span>.');
    });

    it('keeps the italic game titles TheGamer nests inside outbound links', () => {
        // These render grey via `.gv-p em` unless the CSS raises .gv-keyword's specificity.
        const out = rewriteInternalLinks('<a href="/gone/"><em>Persona 5</em> tips</a>', GUIDE, known);
        assert.equal(out, '<span class="gv-keyword"><em>Persona 5</em> tips</span>');
    });

    it('is a no-op on HTML with no root-relative links', () => {
        const html = '<strong>Goro Akechi</strong> joins here.';
        assert.equal(rewriteInternalLinks(html, GUIDE, known), html);
    });
});
