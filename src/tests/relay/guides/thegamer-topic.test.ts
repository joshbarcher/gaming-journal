// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/thegamer-topic.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { rootTagsOf, makeTopicFilter, isOnTopicByTags } from '../../../lib/server/relay/guides/thegamer/fetcher.js';
import { extractArticleTags, extractTagListingSlugs } from '../../../lib/server/relay/guides/thegamer/adapter.js';

// ── Article tags ─────────────────────────────────────────────────────────────

describe('extractArticleTags', () => {
    const strip = inner => `<div class="article-tags"><ul class="article-tags-list">${inner}</ul></div>`;
    const tag = (href, name) => `<li class="article-tags-element"><a class="tags-link" href="${href}"><div>${name}</div></a></li>`;

    it('reads the article\'s own tag strip', () => {
        const html = strip(tag('/tag/persona-5/', 'P5') + tag('/tag/persona-5-royal/', 'P5R'));
        assert.deepEqual([...extractArticleTags(html)].sort(), ['persona-5', 'persona-5-royal']);
    });

    it('skips category links that share the strip', () => {
        // /category/lists/ and /aaa-games/ sit in the same <ul> but are not tags.
        const html = strip(tag('/category/lists/', 'Lists') + tag('/aaa-games/', 'AAA') + tag('/tag/persona-5-royal/', 'P5R'));
        assert.deepEqual([...extractArticleTags(html)], ['persona-5-royal']);
    });

    it('ignores /tag/ links outside the strip', () => {
        // Trending widgets and inline prose link to tags too — those are not this
        // article's topic. Scoping to .article-tags is the whole point.
        const html = `<nav class="w-trending"><a href="/tag/star-fox-2026/">Star Fox</a></nav>
                      <p>See <a href="/tag/skyrim/">Skyrim</a>.</p>` + strip(tag('/tag/persona-5-royal/', 'P5R'));
        assert.deepEqual([...extractArticleTags(html)], ['persona-5-royal']);
    });

    it('returns empty for an untagged article — unknown, not off-topic', () => {
        assert.equal(extractArticleTags(strip(tag('/category/lists/', 'Lists'))).size, 0);
    });
});

// ── Tag listing pages ────────────────────────────────────────────────────────

describe('extractTagListingSlugs', () => {
    // Mirrors the real tag page: cards carry an image link plus category/tag chips,
    // and most of them render OUTSIDE section.w-listing (which holds only the featured
    // block and the chip header — on page 2 it holds no cards at all).
    const card = slug => `<div class="display-card">
        <a class="dc-img-link" href="/${slug}/"><img></a>
        <a class="dc-tag" href="/aaa-games/">Triple-A Games</a>
        <a class="dc-tag" href="/tag/jrpg/">JRPG</a>
    </div>`;
    const page = cards => `<header><div class="display-card"><a class="dc-img-link" href="/promo-article-here/">p</a></div></header>
        <main class="w-content">
            <section class="wrapper w-listing"><a href="/tag/persona-5/">chips</a><a href="/nintendo/">Nintendo</a></section>
            <div class="rich-tag">${cards}</div>
        </main>
        <footer><a href="/reviews-previews/">Reviews</a></footer>`;

    it('collects one article slug per card', () => {
        const html = page(card('persona-5-royal-trophy-guide') + card('persona-5-will-seed'));
        assert.deepEqual([...extractTagListingSlugs(html)].sort(), ['persona-5-royal-trophy-guide', 'persona-5-will-seed']);
    });

    it('finds cards that render outside section.w-listing', () => {
        // The bug this replaced: scoping to section.w-listing returned 3 slugs on page 1
        // and zero on page 2, silently collapsing the allowlist to nothing.
        assert.equal(extractTagListingSlugs(page(card('a-real-guide'))).size, 1);
    });

    it('ignores the category chip inside a card', () => {
        assert.ok(!extractTagListingSlugs(page(card('a-real-guide'))).has('aaa-games'));
    });

    it('ignores unhyphenated brand hubs and chrome outside main', () => {
        const slugs = extractTagListingSlugs(page(card('a-real-guide')));
        assert.ok(!slugs.has('nintendo'));
        assert.ok(!slugs.has('promo-article-here'));
        assert.ok(!slugs.has('reviews-previews'));
    });
});

// ── Root tags ────────────────────────────────────────────────────────────────

describe('rootTagsOf', () => {
    const sets = (...arrs) => arrs.map(a => new Set(a));

    it('keeps tags carried by at least the minimum share of directory pages', () => {
        const tags = sets(['persona-5-royal'], ['persona-5-royal'], ['persona-5-royal', 'persona-5'], ['persona-5-royal']);
        assert.deepEqual([...rootTagsOf(tags, 0.25)].sort(), ['persona-5', 'persona-5-royal']);
    });

    it('drops a tag that only one page in a large set carries', () => {
        const tags = sets(...Array(20).fill(['persona-5-royal']), ['shin-megami-tensei']);
        assert.deepEqual([...rootTagsOf(tags, 0.1)], ['persona-5-royal']);
    });

    it('returns empty for no pages', () => {
        assert.equal(rootTagsOf([]).size, 0);
    });
});

// ── The topic filter ─────────────────────────────────────────────────────────

describe('makeTopicFilter', () => {
    const allow = new Set(['persona-5-niijimas-casino-best-personas', 'makoto-persona-5-strikers-relationship']);
    const onTopic = makeTopicFilter(allow, 'persona-5-royal');

    it('accepts an allowlisted article whose slug lacks the base prefix', () => {
        // The link that started all this — tagged persona-5-royal, slug says otherwise.
        assert.ok(onTopic('persona-5-niijimas-casino-best-personas'));
        // Game token not even at the start of the slug.
        assert.ok(onTopic('makoto-persona-5-strikers-relationship'));
    });

    it('accepts a prefix-matching article that TheGamer never tagged', () => {
        assert.ok(onTopic('persona-5-royal-best-confidant-hangout-scenes-ranked'));
    });

    it('rejects a different game that merely shares a word', () => {
        assert.ok(!onTopic('persona-5-tactica-party-members-ranked-best'));
        assert.ok(!onTopic('persona-best-games-metacritic'));
    });

    it('rejects an unrelated article entirely', () => {
        assert.ok(!onTopic('the-lord-of-the-rings-gollum-elf-langage-sindarin-dlc-real-fans'));
        assert.ok(!onTopic('video-game-characters-with-precognition'));
    });

    it('falls back to prefix-only when no allowlist could be built', () => {
        const prefixOnly = makeTopicFilter(new Set(), 'persona-5-royal');
        assert.ok(prefixOnly('persona-5-royal-trophy-guide'));
        assert.ok(!prefixOnly('persona-5-niijimas-casino-best-personas'));
    });

    it('accepts nothing when there is neither allowlist nor prefix', () => {
        assert.ok(!makeTopicFilter(new Set(), null)('anything-at-all'));
    });
});

// ── The authoritative check, once the page is in hand ────────────────────────
//
// The tag listing only paginates back through the most recent ~250 articles per tag,
// so a fast-path miss means "unknown", not "off-topic". These are the articles that
// were being lost: persona-5-kasumi-romance is tagged persona-5-royal but absent from
// all 13 pages of /tag/persona-5-royal/.

describe('isOnTopicByTags', () => {
    const root = new Set(['persona-5-royal', 'persona-5']);
    const strip = inner => `<div class="article-tags"><ul>${inner}</ul></div>`;
    const tag = href => `<li><a class="tags-link" href="${href}">t</a></li>`;

    it('recovers an article whose own tag strip carries a root tag', () => {
        assert.ok(isOnTopicByTags(strip(tag('/tag/persona-5-royal/')), root));
    });

    it('rejects a different game that the allowlist also missed', () => {
        assert.ok(!isOnTopicByTags(strip(tag('/tag/persona-5-tactica/')), root));
    });

    it('rejects an article tagged only with the series, not the game', () => {
        assert.ok(!isOnTopicByTags(strip(tag('/tag/persona/')), root));
    });

    it('rejects an untagged article — the prefix fast path already covers ours', () => {
        assert.ok(!isOnTopicByTags(strip(tag('/category/lists/')), root));
    });

    it('ignores tag links outside the article tag strip', () => {
        const html = `<nav class="w-trending"><a href="/tag/persona-5-royal/">trending</a></nav>` + strip(tag('/tag/skyrim/'));
        assert.ok(!isOnTopicByTags(html, root));
    });
});
