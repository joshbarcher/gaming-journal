import path from 'node:path';
import fs   from 'node:fs/promises';
import * as cheerio from 'cheerio';
import logger from '../../logger.js';
import { bbcodeToHtml } from '../shared/bbcode.js';
import { featureDir } from '../shared/data-root.js';
import { parseContent } from '../guides/parser/content-parser.js';

const NEWS_PARSE_CFG = { links: { keepExternal: true, keepInternal: false }, br: { behavior: 'keep' } };

// Pull a card preview (first image + text excerpt) out of a news item's HTML.
function newsPreview(html) {
    if (!html) return { previewImage: null, excerpt: '' };
    try {
        const $ = cheerio.load(`<div id="__n">${html}</div>`);
        const previewImage = $('#__n img').first().attr('src') || null;
        const excerpt = $('#__n').text().replace(/\s+/g, ' ').trim().slice(0, 240);
        return { previewImage, excerpt };
    } catch { return { previewImage: null, excerpt: '' }; }
}

// Structured article body (headings / paragraphs / lists / images) via the shared
// guide parser — same pipeline the Nexus mod descriptions use.
export function newsBlocks(html) {
    if (!html) return [];
    try {
        const $ = cheerio.load(`<div id="__n">${html}</div>`);
        return parseContent($, $('#__n')[0], NEWS_PARSE_CFG, {});
    } catch (err) { logger.warn('[news] block parse failed', { err: err.message }); return []; }
}

const NEWS_API   = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/';
const NEWS_COUNT = 15;

// Feeds that add noise rather than game-specific news
const BLOCKED_FEEDS = new Set(['SteamDB']);

// Unicode ranges for non-Latin scripts (Cyrillic, CJK, Hiragana/Katakana, Korean, Arabic, Thai)
const NON_LATIN_RE = /[Ѐ-ӿ一-鿿぀-ヿ가-힯؀-ۿ฀-๿]/;

function isEnglish(item) {
    return !NON_LATIN_RE.test(item.title);
}

function isRelevant(item) {
    return !BLOCKED_FEEDS.has(item.feedname);
}

function processItem(item) {
    const contents = bbcodeToHtml(item.contents);
    const { previewImage, excerpt } = newsPreview(contents);
    return {
        gid:             item.gid,
        title:           item.title,
        url:             item.url,
        is_external_url: item.is_external_url,
        author:          item.author,
        contents,
        previewImage,
        excerpt,
        feedlabel:       item.feedlabel,
        feedname:        item.feedname,
        date:            item.date,
    };
}

function newsDir()       { return path.join(featureDir('steam'), 'news'); }
function newsPath(appid) { return path.join(newsDir(), `${appid}.json`); }

async function readJson(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

export async function fetchAndCache(appid) {
    const url = `${NEWS_API}?appid=${appid}&count=${NEWS_COUNT}&maxlength=0&format=json`;
    logger.info('[news] Fetching', { appid });

    const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
    if (res.status === 429) throw Object.assign(new Error('rate-limited'), { rateLimited: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const raw  = json?.appnews?.newsitems ?? [];

    const items = raw
        .filter(isRelevant)
        .filter(isEnglish)
        .map(processItem);

    const data = { fetchedAt: new Date().toISOString(), appid, items };

    await fs.mkdir(newsDir(), { recursive: true });
    await fs.writeFile(newsPath(appid), JSON.stringify(data, null, 2), 'utf8');
    logger.info('[news] Cached', { appid, raw: raw.length, kept: items.length });
    return data;
}

export async function getNews(appid) {
    const data = await readJson(newsPath(appid));
    if (!data?.items?.length) return data;

    // Self-heal caches written before previewImage/excerpt existed (one-time backfill).
    let changed = false;
    for (const it of data.items) {
        if (it.previewImage === undefined) {
            const { previewImage, excerpt } = newsPreview(it.contents);
            it.previewImage = previewImage;
            it.excerpt = excerpt;
            changed = true;
        }
    }
    if (changed) await fs.writeFile(newsPath(appid), JSON.stringify(data, null, 2), 'utf8').catch(() => {});
    return data;
}

// One article by gid, with its body parsed into ContentBlock[] for the article page.
export async function getArticle(appid, gid) {
    const data = await getNews(appid);
    const item = data?.items?.find(i => String(i.gid) === String(gid));
    if (!item) return null;
    const { contents, ...meta } = item;
    let blocks = newsBlocks(contents);
    // The preview image is the article's first <img>; it's shown as the page hero,
    // so drop it from the body to avoid rendering the same image twice.
    if (blocks[0]?.type === 'image' && blocks[0].src === meta.previewImage) blocks = blocks.slice(1);
    return { ...meta, blocks };
}
