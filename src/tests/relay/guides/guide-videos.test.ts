// @ts-nocheck — the guides parser/cleaner are untyped .js services (see content-parser.test.ts).
//
// YouTube embeds used to be deleted three different ways before reaching content.json:
// <iframe> is in ALWAYS_REMOVE, Steam's embed is an empty <div> that collapseEmpties
// pruned, and a plain link was flattened to text by the external-link policy. These
// cover each route in and the `video` block that comes out.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { loadAndClean, cleanInlineHtml, youtubeId } from '../../../lib/server/relay/guides/parser/html-cleaner.js';
import { parseContent, collectImageBlocks } from '../../../lib/server/relay/guides/parser/content-parser.js';
import { defaults } from '../../../lib/server/relay/guides/config.js';

const cfg = { ...defaults, links: { keepExternal: false } };
const adapter = { contentSelector: '#content', junkSelectors: [] };

/** Full pipeline: raw page HTML → cleaned DOM → ContentBlock[]. */
function pipeline(html) {
    const { $, content } = loadAndClean(`<html><body><div id="content">${html}</div></body></html>`, adapter);
    return parseContent($, content[0], cfg, {});
}

/** Parser only, for markup that already carries placeholders. */
function parse(html) {
    const $ = cheerio.load(`<div id="content">${html}</div>`);
    return parseContent($, $('#content')[0], cfg, {});
}

const ID = '14V7YEJgSeI';

// ── youtubeId ─────────────────────────────────────────────────────────────────

describe('youtubeId', () => {
    it('reads every link shape a guide can carry', () => {
        assert.equal(youtubeId(`https://www.youtube.com/watch?v=${ID}`), ID);
        assert.equal(youtubeId(`https://youtu.be/${ID}`), ID);
        assert.equal(youtubeId(`https://www.youtube.com/embed/${ID}?rel=0`), ID);
        assert.equal(youtubeId(`https://www.youtube.com/shorts/${ID}`), ID);
        assert.equal(youtubeId(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
        assert.equal(youtubeId(`//www.youtube.com/embed/${ID}`), ID);
        assert.equal(youtubeId(`https://www.youtube.com/watch?v=${ID}&t=90s`), ID);
    });

    it('rejects non-YouTube and malformed input', () => {
        assert.equal(youtubeId('https://vimeo.com/12345'), null);
        assert.equal(youtubeId('https://www.youtube.com/watch?v=tooshort'), null);
        assert.equal(youtubeId(''), null);
        assert.equal(youtubeId(null), null);
    });

    it('does not resolve a relative href against youtube.com', () => {
        // Guides are full of bare internal links; treating one as a video would replace
        // page content with a bogus player.
        assert.equal(youtubeId('/watch?v=aaaaaaaaaaa'), null);
        assert.equal(youtubeId('some-page'), null);
    });
});

// ── Survival through the cleaner ──────────────────────────────────────────────

describe('video embeds survive cleaning', () => {
    it('keeps a Steam embed, whose empty div collapseEmpties used to prune', () => {
        const blocks = pipeline(`<div class="sharedFilePreviewYouTubeVideo sizeFull" id="${ID}"></div>`);
        assert.deepEqual(blocks.map(b => b.type), ['video']);
        assert.equal(blocks[0].videoId, ID);
    });

    it('keeps an <iframe> embed, which ALWAYS_REMOVE used to delete', () => {
        const blocks = pipeline(`<iframe src="https://www.youtube.com/embed/${ID}" width="560"></iframe>`);
        assert.deepEqual(blocks.map(b => b.type), ['video']);
        assert.equal(blocks[0].videoId, ID);
    });

    it('still removes iframes that are not videos', () => {
        assert.deepEqual(pipeline('<iframe src="https://ads.example.com/x"></iframe><p>after</p>')
            .map(b => b.type), ['paragraph']);
    });

    it('ignores a Steam-shaped div whose id is not a video id', () => {
        assert.deepEqual(pipeline('<div class="sharedFilePreviewYouTubeVideo" id="header"></div><p>x</p>')
            .map(b => b.type), ['paragraph']);
    });
});

// ── The video block ───────────────────────────────────────────────────────────

describe('video blocks', () => {
    it('carries the canonical watch URL, not a player URL', () => {
        // content.json is the archival record; routing to Tributary is the viewer's job.
        const [block] = parse(`<div data-yt-video="${ID}"></div>`);
        assert.equal(block.url, `https://www.youtube.com/watch?v=${ID}`);
        assert.equal(block.provider, 'youtube');
    });

    it('carries an image-shaped poster frame for the download pass', () => {
        const [block] = parse(`<div data-yt-video="${ID}"></div>`);
        assert.equal(block.thumb.type, 'image');
        assert.equal(block.thumb.role, 'video-thumb');
        assert.match(block.thumb.src, new RegExp(`/vi/${ID}/`));
    });

    it('offers hqdefault as the fallback for videos with no maxres frame', () => {
        const [block] = parse(`<div data-yt-video="${ID}"></div>`);
        assert.match(block.thumb.src, /maxresdefault/);
        assert.match(block.thumb.srcFallback, /hqdefault/);
    });

    it('is collected as an image so the thumbnail downloads and is kept', () => {
        const blocks = parse(`<div data-yt-video="${ID}"></div>`);
        const imgs = collectImageBlocks(blocks);
        assert.equal(imgs.length, 1);
        // Live reference — downloadImages sets localSrc on the object in the tree.
        imgs[0].localSrc = 'img/001.jpg';
        assert.equal(blocks[0].thumb.localSrc, 'img/001.jpg');
    });

    it('lifts an embed out of a <p> and keeps the surrounding text', () => {
        const blocks = parse(`<p>Watch this: <span data-yt-video="${ID}"></span></p>`);
        assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'video']);
        assert.match(blocks[0].html, /Watch this/);
    });

    it('emits nothing but the video when the <p> held only the embed', () => {
        assert.deepEqual(parse(`<p><span data-yt-video="${ID}"></span></p>`).map(b => b.type), ['video']);
    });

    it('takes its caption from a wrapping <figure>', () => {
        const [block] = parse(`<figure><div data-yt-video="${ID}"></div><figcaption>Boss fight</figcaption></figure>`);
        assert.equal(block.type, 'video');
        assert.equal(block.caption, 'Boss fight');
    });

    it('survives inside nested wrappers', () => {
        const blocks = parse(`<div><div class="wrap"><div data-yt-video="${ID}"></div></div></div>`);
        assert.deepEqual(blocks.map(b => b.type), ['video']);
    });
});

// ── Inline links ──────────────────────────────────────────────────────────────

describe('YouTube links in prose', () => {
    it('keeps the link the external-link policy used to flatten', () => {
        const html = cleanInlineHtml(`See <a href="https://youtu.be/${ID}">this video</a>`, cfg);
        assert.match(html, /<a[^>]+href="https:\/\/youtu\.be\/14V7YEJgSeI"/);
        assert.match(html, /data-yt="14V7YEJgSeI"/);
        assert.match(html, />this video</);
    });

    it('preserves a start time in the href', () => {
        const html = cleanInlineHtml(`<a href="https://www.youtube.com/watch?v=${ID}&amp;t=90s">at 1:30</a>`, cfg);
        assert.match(html, /t=90s/);
    });

    it('normalises a protocol-relative href to https', () => {
        const html = cleanInlineHtml(`<a href="//youtu.be/${ID}">v</a>`, cfg);
        assert.match(html, /href="https:\/\/youtu\.be\//);
    });

    it('drops class and target from the anchor, as with any other link', () => {
        const html = cleanInlineHtml(`<a class="x" target="_self" href="https://youtu.be/${ID}">v</a>`, cfg);
        assert.doesNotMatch(html, /class=|target=/);
    });

    it('still strips other external links', () => {
        const html = cleanInlineHtml('<a href="https://example.com/x">elsewhere</a>', cfg);
        assert.equal(html, 'elsewhere');
    });
});
