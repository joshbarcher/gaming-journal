// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/reddit/reddit.test.js (node:test → vitest).
// Contract tests for the content filter + post shaper — behavior must match the
// relay exactly (docs/relay-fold-in.md §6: parity is the correctness definition
// during migration, so assertions are carried over unmodified).
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { shouldInclude, shapePost } from '../../lib/server/relay/reddit/reddit.filter.js';

// ── shouldInclude ─────────────────────────────────────────────────────────────

function post(overrides = {}) {
    return {
        id: 'abc', title: 'Great game moment', selftext: 'Had so much fun',
        score: 100, num_comments: 20, author: 'user1',
        subreddit: 'pcgaming', permalink: '/r/pcgaming/comments/abc',
        over_18: false, removed_by_category: null,
        link_flair_text: null, post_hint: null, is_gallery: false,
        created_utc: 1700000000, domain: 'self.pcgaming',
        ...overrides,
    }
}

describe('shouldInclude', () => {
    test('allows normal gaming post', () => {
        assert.equal(shouldInclude(post()), true)
    })

    test('blocks NSFW posts', () => {
        assert.equal(shouldInclude(post({ over_18: true })), false)
    })

    test('blocks removed posts', () => {
        assert.equal(shouldInclude(post({ removed_by_category: 'moderator' })), false)
    })

    test('blocks [removed] selftext', () => {
        assert.equal(shouldInclude(post({ selftext: '[removed]' })), false)
    })

    test('blocks [deleted] selftext', () => {
        assert.equal(shouldInclude(post({ selftext: '[deleted]' })), false)
    })

    test('blocks zero score', () => {
        assert.equal(shouldInclude(post({ score: 0 })), false)
    })

    test('blocks negative score', () => {
        assert.equal(shouldInclude(post({ score: -5 })), false)
    })

    test('blocks political title — trump', () => {
        assert.equal(shouldInclude(post({ title: 'Trump says gaming is bad' })), false)
    })

    test('blocks political title — election', () => {
        assert.equal(shouldInclude(post({ title: 'Election coverage in this game is interesting' })), false)
    })

    test('blocks propaganda keyword', () => {
        assert.equal(shouldInclude(post({ title: 'This game is pure propaganda' })), false)
    })

    test('blocks NFT keyword', () => {
        assert.equal(shouldInclude(post({ title: 'This game is adding NFT support' })), false)
    })

    test('blocks political flair', () => {
        assert.equal(shouldInclude(post({ link_flair_text: 'Politics' })), false)
    })

    test('allows gaming post with score 1', () => {
        assert.equal(shouldInclude(post({ score: 1 })), true)
    })
})

// ── shapePost ─────────────────────────────────────────────────────────────────

describe('shapePost', () => {
    test('shapes a basic text post', () => {
        const raw    = post()
        const shaped = shapePost(raw)
        assert.equal(shaped.id,          'abc')
        assert.equal(shaped.title,       'Great game moment')
        assert.equal(shaped.selftext,    'Had so much fun')
        assert.equal(shaped.score,       100)
        assert.equal(shaped.numComments, 20)
        assert.equal(shaped.author,      'user1')
        assert.equal(shaped.subreddit,   'pcgaming')
        assert.equal(shaped.isImage,     false)
        assert.equal(shaped.imageUrl,    null)
        assert.ok(shaped.permalink.startsWith('https://www.reddit.com'))
    })

    test('detects image post', () => {
        const shaped = shapePost(post({ post_hint: 'image', url_overridden_by_dest: 'https://i.redd.it/abc.jpg' }))
        assert.equal(shaped.isImage, true)
        assert.equal(shaped.imageUrl, 'https://i.redd.it/abc.jpg')
    })

    test('detects gallery post', () => {
        const shaped = shapePost(post({ is_gallery: true }))
        assert.equal(shaped.isImage, true)
    })

    test('truncates selftext at 600 chars', () => {
        const long   = 'x'.repeat(1000)
        const shaped = shapePost(post({ selftext: long }))
        assert.equal(shaped.selftext.length, 600)
    })

    test('returns null selftext for removed body', () => {
        const shaped = shapePost(post({ selftext: '[removed]' }))
        assert.equal(shaped.selftext, null)
    })

    test('decodes &amp; in thumbnail URL', () => {
        const preview = { images: [{ source: { url: 'https://preview.redd.it/img.jpg?a=1&amp;b=2', width: 640, height: 360 }, resolutions: [{ url: 'https://preview.redd.it/img.jpg?a=1&amp;b=2', width: 320, height: 180 }] }] }
        const shaped  = shapePost(post({ preview }))
        assert.ok(!shaped.thumbnail?.includes('&amp;'))
    })
})
