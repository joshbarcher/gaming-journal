// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/thegamer-related.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { extractRelatedSlugs } from '../../../lib/server/relay/guides/thegamer/fetcher.js';

// Minimal stand-in for a TheGamer article: the content region the adapter selects,
// plus the chrome around it that junk selectors are supposed to remove.
function article({ body = '', chrome = '' } = {}) {
    return `<html><body>
        <header><a href="/feed/">Feed</a></header>
        <article><div class="article-body">
            ${body}
            ${chrome}
        </div></article>
        <footer><a href="/trending-guides/">Trending</a></footer>
    </body></html>`;
}

const slugs = html => [...extractRelatedSlugs(html).keys()].sort();

describe('extractRelatedSlugs', () => {
    it('picks up an inline RELATED: link', () => {
        const html = article({ body: '<p><span class="related-single">RELATED: <a href="https://www.thegamer.com/p5r-trophy-guide/">Trophies</a></span></p>' });
        assert.deepEqual(slugs(html), ['p5r-trophy-guide']);
    });

    it('picks up root-relative prose links', () => {
        assert.deepEqual(slugs(article({ body: '<p>See <a href="/p5r-will-seed/">Will Seeds</a>.</p>' })), ['p5r-will-seed']);
    });

    it('counts how many times each article is linked', () => {
        const html = article({ body: '<p><a href="/a-guide/">x</a><a href="/a-guide/">y</a><a href="/b-guide/">z</a></p>' });
        const counts = extractRelatedSlugs(html);
        assert.equal(counts.get('a-guide'), 2);
        assert.equal(counts.get('b-guide'), 1);
    });

    it('accumulates across pages into a shared Map', () => {
        const counts = extractRelatedSlugs(article({ body: '<p><a href="/a-guide/">x</a></p>' }));
        extractRelatedSlugs(article({ body: '<p><a href="/a-guide/">x</a></p>' }), counts);
        assert.equal(counts.get('a-guide'), 2);
    });

    it('ignores site chrome outside the content region', () => {
        // /feed/ and /trending-guides/ live in header/footer and dominate the raw HTML.
        assert.deepEqual(slugs(article({ body: '<p><a href="/real-guide/">x</a></p>' })), ['real-guide']);
    });

    it('ignores chrome inside the content region that junk selectors remove', () => {
        const html = article({
            body:   '<p><a href="/real-guide/">x</a></p>',
            chrome: '<div class="related"><a href="/recirculation-bait/">x</a></div>',
        });
        assert.deepEqual(slugs(html), ['real-guide']);
    });

    it('rejects section landing pages (/tag/, /author/, /category/)', () => {
        const html = article({ body: '<p><a href="/author/meg-pelliccio/">Meg</a><a href="/tag/persona-5/">P5</a><a href="/category/guides/">G</a></p>' });
        assert.deepEqual(slugs(html), []);
    });

    it('rejects other hosts', () => {
        assert.deepEqual(slugs(article({ body: '<p><a href="https://example.com/foo/">x</a></p>' })), []);
    });

    it('ignores fragment-only jump links', () => {
        assert.deepEqual(slugs(article({ body: '<p><a href="#the-tower">Tower</a></p>' })), []);
    });

    it('returns the accumulator untouched when there is no content region', () => {
        // An interstitial or error page — must not throw.
        const counts = extractRelatedSlugs('<html><body><p>Access denied</p></body></html>');
        assert.equal(counts.size, 0);
    });
});
