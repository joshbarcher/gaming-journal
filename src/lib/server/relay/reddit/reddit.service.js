import path from 'node:path';
import fs   from 'node:fs/promises';
import logger from '../../logger.js';
import { recordWrite } from '../../../../../activity.js';
import { getSubreddit } from '../igdb/igdb.service.js';
import { resolveImgurUrl } from '../imgur/imgur.service.js';
import { browserGet } from '../browser/browser.service.js';
import { getAllGames } from '../shared/getAllGames.js';
import { featureDir } from '../shared/data-root.js';
import { shouldInclude, shapePost, shapeComment } from './reddit.filter.js';
import { tracked } from '../metrics/tracked.js';

// Re-export so boot import paths stay unchanged (relay server.js imported
// startBrowser/closeBrowser through this module).
export { startBrowser, closeBrowser } from '../browser/browser.service.js';

const REDDIT_BASE   = 'https://www.reddit.com';
const CACHE_TTL_MS  = 6 * 3_600_000;  // 6 hours
const POSTS_PER_SORT = 50;            // posts fetched per sort listing
const MAX_STORED_POSTS = 200;         // cap on accumulated posts per source
const REQ_GAP_MIN_MS = 1_800;
const REQ_GAP_MAX_MS = 4_200;

// Each subreddit is pulled across several sort listings and the results merged,
// so the feed captures brand-new posts (not just what's "hot" right now) plus a
// week of top and controversial discussion.
const SUBREDDIT_SORTS = [
    { sort: 'hot' },
    { sort: 'new' },
    { sort: 'top',           t: 'week' },
    { sort: 'controversial', t: 'week' },
];

// Daily background sync — spacing + scope.
const DAILY_STARTUP_DELAY_MS = 5 * 60_000;   // let startup settle before first run
const DAILY_RECENT_DAYS      = 21;           // include games played in the last N days
const GAME_GAP_MIN_MS        = 30_000;
const GAME_GAP_MAX_MS        = 60_000;

function redditDir()                   { return featureDir('reddit'); }
function entryPath(appid)              { return path.join(redditDir(), `${appid}.json`); }
function commentsDir(appid)            { return path.join(redditDir(), 'comments',  String(appid)); }
function imagesDir(appid)              { return path.join(redditDir(), 'images',    String(appid)); }
function videosDir(appid)              { return path.join(redditDir(), 'videos',    String(appid)); }
function sharedSubsDir()               { return path.join(redditDir(), 'subreddits'); }
function sharedSubPath(sub)            { return path.join(sharedSubsDir(), `${sub.toLowerCase()}.json`); }
function sharedImagesDir(sub)          { return path.join(redditDir(), 'images', 'subreddits', sub.toLowerCase()); }
function sharedVideosDir(sub)          { return path.join(redditDir(), 'videos', 'subreddits', sub.toLowerCase()); }
export function threadPath(appid, postId){ return path.join(commentsDir(appid), `${postId}.json`); }
function userSubredditsPath()          { return path.join(process.env.DATA_DIR, 'gaming-journal', 'reddit-subreddits.json'); }

async function _getUserSubreddits(appid) {
    try {
        const data = JSON.parse(await fs.readFile(userSubredditsPath(), 'utf8'));
        return data[String(appid)] ?? [];
    } catch { return []; }
}

// Derive a safe extension from a URL, defaulting to .jpg
function _imageExt(url) {
    try {
        const m = new URL(url).pathname.match(/\.(jpe?g|png|gif|webp)$/i);
        return m ? `.${m[1].toLowerCase()}` : '.jpg';
    } catch { return '.jpg'; }
}

export function localImageUrl(appid, postId, imageUrl) {
    return `/images/reddit/${appid}/${postId}${_imageExt(imageUrl)}`;
}
export function localThumbUrl(appid, postId, thumbUrl) {
    return `/images/reddit/${appid}/${postId}_thumb${_imageExt(thumbUrl)}`;
}
export function localVideoUrl(appid, postId) {
    return `/videos/reddit/${appid}/${postId}.mp4`;
}

export function localSharedImageUrl(sub, postId, imageUrl) {
    return `/images/reddit/subreddits/${sub.toLowerCase()}/${postId}${_imageExt(imageUrl)}`;
}
export function localSharedThumbUrl(sub, postId, thumbUrl) {
    return `/images/reddit/subreddits/${sub.toLowerCase()}/${postId}_thumb${_imageExt(thumbUrl)}`;
}
export function localSharedVideoUrl(sub, postId) {
    return `/videos/reddit/subreddits/${sub.toLowerCase()}/${postId}.mp4`;
}
export function localGalleryImageUrl(appid, postId, idx, url) {
    return `/images/reddit/${appid}/${postId}_g${idx}${_imageExt(url)}`;
}
export function localSharedGalleryImageUrl(sub, postId, idx, url) {
    return `/images/reddit/subreddits/${sub.toLowerCase()}/${postId}_g${idx}${_imageExt(url)}`;
}

export async function cacheVideo(appid, postId, videoUrl, { force = false } = {}) {
    if (!videoUrl) return null;
    await fs.mkdir(videosDir(appid), { recursive: true });
    const dest = path.join(videosDir(appid), `${postId}.mp4`);
    if (!force) { try { await fs.access(dest); return localVideoUrl(appid, postId); } catch {} }
    const ok = await _cacheFile(dest, videoUrl, 'video');
    return ok ? localVideoUrl(appid, postId) : null;
}

// Download and cache a file. Returns the local URL path, or null on failure.
// Uses plain fetch — Reddit CDNs don't require browser fingerprinting.
async function _cacheFile(dest, url, logLabel) {
    try { await fs.access(dest); return true; } catch {} // already exists
    try {
        const res = await fetch(url);
        if (!res.ok) { logger.debug(`[reddit] ${logLabel} fetch failed`, { status: res.status }); return false; }
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(dest, buf);
        recordWrite(buf.length, dest); // NAS reddit media (see activity.js)
        return true;
    } catch (err) {
        logger.warn(`[reddit] ${logLabel} cache error`, { err: err.message });
        return false;
    }
}

export async function cacheImage(appid, postId, imageUrl, { force = false } = {}) {
    if (!imageUrl) return null;
    await fs.mkdir(imagesDir(appid), { recursive: true });
    const dest = path.join(imagesDir(appid), `${postId}${_imageExt(imageUrl)}`);
    if (!force) { try { await fs.access(dest); return localImageUrl(appid, postId, imageUrl); } catch {} }
    const ok = await _cacheFile(dest, imageUrl, 'image');
    return ok ? localImageUrl(appid, postId, imageUrl) : null;
}

export async function cacheThumb(appid, postId, thumbUrl, { force = false } = {}) {
    if (!thumbUrl) return null;
    await fs.mkdir(imagesDir(appid), { recursive: true });
    const dest = path.join(imagesDir(appid), `${postId}_thumb${_imageExt(thumbUrl)}`);
    if (!force) { try { await fs.access(dest); return localThumbUrl(appid, postId, thumbUrl); } catch {} }
    const ok = await _cacheFile(dest, thumbUrl, 'thumb');
    return ok ? localThumbUrl(appid, postId, thumbUrl) : null;
}

export async function cacheSharedImage(sub, postId, imageUrl, { force = false } = {}) {
    if (!imageUrl) return null;
    await fs.mkdir(sharedImagesDir(sub), { recursive: true });
    const dest = path.join(sharedImagesDir(sub), `${postId}${_imageExt(imageUrl)}`);
    if (!force) { try { await fs.access(dest); return localSharedImageUrl(sub, postId, imageUrl); } catch {} }
    const ok = await _cacheFile(dest, imageUrl, 'image');
    return ok ? localSharedImageUrl(sub, postId, imageUrl) : null;
}

export async function cacheSharedThumb(sub, postId, thumbUrl, { force = false } = {}) {
    if (!thumbUrl) return null;
    await fs.mkdir(sharedImagesDir(sub), { recursive: true });
    const dest = path.join(sharedImagesDir(sub), `${postId}_thumb${_imageExt(thumbUrl)}`);
    if (!force) { try { await fs.access(dest); return localSharedThumbUrl(sub, postId, thumbUrl); } catch {} }
    const ok = await _cacheFile(dest, thumbUrl, 'thumb');
    return ok ? localSharedThumbUrl(sub, postId, thumbUrl) : null;
}

export async function cacheGalleryImage(appid, postId, idx, url, { force = false } = {}) {
    if (!url) return null;
    await fs.mkdir(imagesDir(appid), { recursive: true });
    const dest = path.join(imagesDir(appid), `${postId}_g${idx}${_imageExt(url)}`);
    if (!force) { try { await fs.access(dest); return localGalleryImageUrl(appid, postId, idx, url); } catch {} }
    const ok = await _cacheFile(dest, url, 'gallery-image');
    return ok ? localGalleryImageUrl(appid, postId, idx, url) : null;
}

export async function cacheSharedGalleryImage(sub, postId, idx, url, { force = false } = {}) {
    if (!url) return null;
    await fs.mkdir(sharedImagesDir(sub), { recursive: true });
    const dest = path.join(sharedImagesDir(sub), `${postId}_g${idx}${_imageExt(url)}`);
    if (!force) { try { await fs.access(dest); return localSharedGalleryImageUrl(sub, postId, idx, url); } catch {} }
    const ok = await _cacheFile(dest, url, 'gallery-image');
    return ok ? localSharedGalleryImageUrl(sub, postId, idx, url) : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter()  { return REQ_GAP_MIN_MS + Math.random() * (REQ_GAP_MAX_MS - REQ_GAP_MIN_MS); }

// ── Sync progress tracker ─────────────────────────────────────────────────────
// Keyed by appid. Subscribers are SSE response objects.
const _progress = new Map(); // appid → { message, done, subscribers: Set<res> }

export function initProgress(appid) {
    _progress.set(appid, { message: 'Starting…', done: false, subscribers: new Set() });
}

export function subscribeProgress(appid, res) {
    const state = _progress.get(appid);
    if (!state || state.done) {
        // No active sync — signal done immediately so the client unblocks
        _sendProgress(res, { type: 'done' });
        return () => {};
    }
    state.subscribers.add(res);
    if (state.message) _sendProgress(res, { type: 'status', message: state.message });
    return () => state.subscribers.delete(res);
}

function _sendProgress(res, event) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function _emit(appid, event) {
    const state = _progress.get(appid);
    if (!state) return;
    if (event.message) state.message = event.message;
    if (event.type === 'done') state.done = true;
    for (const res of state.subscribers) _sendProgress(res, event);
    if (event.type === 'done') setTimeout(() => _progress.delete(appid), 10_000);
}

// ── Reddit API calls ──────────────────────────────────────────────────────────

async function redditGetListing(url) {
    const json = await browserGet(url);
    if (json?.error) throw new Error(`Reddit error ${json.error}: ${json.message}`);
    return json?.data?.children?.map(c => c.data) ?? [];
}

// Search a subreddit for posts matching a query
async function fetchSearch(subreddit, query) {
    const params = new URLSearchParams({
        q: `"${query}"`, restrict_sr: '1', sort: 'relevance',
        t: 'year', limit: String(POSTS_PER_SORT), raw_json: '1',
    });
    return redditGetListing(`${REDDIT_BASE}/r/${subreddit}/search.json?${params}`);
}

// Fetch a single sort listing (hot / new / top / controversial) from a subreddit.
async function fetchListing(subreddit, sort, t) {
    const params = new URLSearchParams({ limit: String(POSTS_PER_SORT), raw_json: '1' });
    if (t) params.set('t', t);
    return redditGetListing(`${REDDIT_BASE}/r/${subreddit}/${sort}.json?${params}`);
}

// Fetch every configured sort for a subreddit and return the deduped raw posts.
async function fetchSubredditMulti(subreddit) {
    const seen = new Map(); // id → raw post (first sort to surface it wins)
    for (let i = 0; i < SUBREDDIT_SORTS.length; i++) {
        const { sort, t } = SUBREDDIT_SORTS[i];
        try {
            const raw = await fetchListing(subreddit, sort, t);
            for (const r of raw) if (r?.id && !seen.has(r.id)) seen.set(r.id, r);
        } catch (err) {
            logger.warn('[reddit] Sort fetch failed', { subreddit, sort, err: err.message });
        }
        if (i < SUBREDDIT_SORTS.length - 1) await sleep(jitter());
    }
    return [...seen.values()];
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function readJson(p) {
    return fs.readFile(p, 'utf8')
        .then(s => JSON.parse(s.replace(/\0+$/, '')))  // strip trailing null bytes from NAS writes
        .catch(() => null)
}

export async function getEntry(appid)             { return readJson(entryPath(appid)); }
export async function getSharedSub(subreddit)     { return readJson(sharedSubPath(subreddit)); }
export async function getThread(appid, postId)    { return readJson(threadPath(appid, postId)); }

// Resolve shared source references into their full post lists for serving.
export async function resolveEntry(appid) {
    const entry = await getEntry(appid);
    if (!entry) return null;
    const resolvedSources = await Promise.all(
        (entry.sources ?? []).map(async source => {
            if (!source.shared) return source;
            const shared = await getSharedSub(source.subreddit);
            return { subreddit: source.subreddit, posts: shared?.posts ?? [] };
        })
    );
    return { ...entry, sources: resolvedSources };
}

export async function fetchAndCacheThread(appid, postId, subreddit, { force = false } = {}) {
    await fs.mkdir(commentsDir(appid), { recursive: true });

    if (!force) {
        const cached = await getThread(appid, postId);
        if (cached) {
            const post   = cached.post;
            const imgUrl = post.imageUrl ?? post.url ?? null;
            const vidUrl = post.videoUrl ?? null;

            // Threads cached before the i.redd.it domain fix may have no imageUrl
            // and no url stored — trigger a re-fetch so they pick up the new detection.
            // Threads cached before gallery support won't have isGallery/galleryImages —
            // the stored localImage is actually the gallery HTML page, not an image.
            if (!post.localImage && post.domain === 'i.redd.it' && !imgUrl) {
                logger.info('[reddit] Re-fetching stale i.redd.it thread (no image URL stored)', { postId });
                // fall through to re-fetch
            } else if (post.isGallery === undefined && post.url?.includes('/gallery/')) {
                logger.info('[reddit] Re-fetching stale gallery thread (pre-gallery-support cache)', { postId });
                // fall through to re-fetch
            } else {
                // Backfill any media that wasn't cached on the first fetch
                let dirty = false;
                if (!post.localVideo && post.isVideo && vidUrl) {
                    const local = await cacheVideo(appid, post.id, vidUrl);
                    if (local) { post.localVideo = local; dirty = true; }
                }
                if (post.isGallery && post.galleryImages?.length) {
                    for (let i = 0; i < post.galleryImages.length; i++) {
                        const gimg = post.galleryImages[i];
                        if (gimg.localImage) continue;
                        const local = await cacheGalleryImage(appid, post.id, i, gimg.url);
                        if (local) { gimg.localImage = local; dirty = true; }
                    }
                } else if (!post.localImage && !post.isVideo && imgUrl) {
                    const local = await cacheImage(appid, post.id, imgUrl);
                    if (local) { post.localImage = local; dirty = true; }
                }
                if (!post.localThumb && post.thumbnail) {
                    const local = await cacheThumb(appid, post.id, post.thumbnail);
                    if (local) { post.localThumb = local; dirty = true; }
                }
                // Backfill comment images, Giphy GIFs, and Imgur links
                const commentsBefore = JSON.stringify(cached.comments);
                await _cacheCommentImages(appid, postId, cached.comments);
                await _cacheCommentGifs(appid, postId, cached.comments);
                await _cacheCommentImgur(appid, postId, cached.comments);
                if (JSON.stringify(cached.comments) !== commentsBefore) dirty = true;

                if (dirty) {
                    await fs.writeFile(threadPath(appid, postId), JSON.stringify(cached, null, 2));
                    await _propagateMediaToEntry(appid, postId, post);
                }
                return { hit: true, thread: cached };
            }
        }
    }

    const url  = `${REDDIT_BASE}/r/${subreddit}/comments/${postId}.json?limit=500&depth=10&raw_json=1`;
    const json = await browserGet(url);
    const [postListing, commentsListing] = json;

    const postRaw  = postListing.data.children[0].data;
    const post     = shapePost(postRaw);
    const comments = (commentsListing.data.children ?? [])
        .map(c => shapeComment(c, 0))
        .filter(Boolean);

    // Cache comment images, Giphy GIFs, and Imgur links
    await _cacheCommentImages(appid, postId, comments);
    await _cacheCommentGifs(appid, postId, comments);
    await _cacheCommentImgur(appid, postId, comments);

    // Cache post media so the thread view can serve everything locally
    if (post.isVideo && post.videoUrl) {
        const local = await cacheVideo(appid, post.id, post.videoUrl);
        if (local) post.localVideo = local;
    } else if (post.isGallery && post.galleryImages?.length) {
        for (let i = 0; i < post.galleryImages.length; i++) {
            const gimg  = post.galleryImages[i];
            const local = await cacheGalleryImage(appid, post.id, i, gimg.url);
            if (local) gimg.localImage = local;
        }
    } else {
        const fullUrl = post.isImage ? post.imageUrl : (post.previewUrl ?? null);
        if (fullUrl) {
            const local = await cacheImage(appid, post.id, fullUrl);
            if (local) post.localImage = local;
        }
    }
    if (post.thumbnail) {
        const local = await cacheThumb(appid, post.id, post.thumbnail);
        if (local) post.localThumb = local;
    }

    const thread = {
        postId,
        subreddit,
        fetchedAt: new Date().toISOString(),
        post,
        comments,
    };

    await fs.writeFile(threadPath(appid, postId), JSON.stringify(thread, null, 2));
    logger.info('[reddit] Cached thread', { postId, subreddit, comments: comments.length });

    // Propagate cached media paths back to the listing entry so the community
    // card shows the image without waiting for a full re-sync.
    await _propagateMediaToEntry(appid, postId, post);

    return { hit: false, thread };
}

// Write localImage/localThumb/localVideo/galleryImages back to the matching post
// in the entry file so listing cards reflect media cached during a thread fetch.
async function _propagateMediaToEntry(appid, postId, post) {
    const hasGallery = post.galleryImages?.some(g => g.localImage);
    if (!post.localImage && !post.localThumb && !post.localVideo && !hasGallery) return;
    try {
        const entry = await getEntry(appid);
        if (!entry) return;
        let dirty = false;
        for (const source of entry.sources ?? []) {
            if (source.shared) continue;
            const ep = source.posts?.find(p => p.id === postId);
            if (!ep) continue;
            if (post.localImage && !ep.localImage) { ep.localImage = post.localImage; dirty = true; }
            if (post.localThumb && !ep.localThumb) { ep.localThumb = post.localThumb; dirty = true; }
            if (post.localVideo && !ep.localVideo) { ep.localVideo = post.localVideo; dirty = true; }
            if (hasGallery && ep.galleryImages?.length) {
                for (let i = 0; i < post.galleryImages.length && i < ep.galleryImages.length; i++) {
                    if (post.galleryImages[i].localImage && !ep.galleryImages[i].localImage) {
                        ep.galleryImages[i].localImage = post.galleryImages[i].localImage;
                        dirty = true;
                    }
                }
            }
            break;
        }
        if (dirty) await fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2));
    } catch (err) {
        logger.warn('[reddit] Entry propagation failed', { postId, err: err.message });
    }
}

// Resolve and cache Imgur links found in comments.
// Each comment.imgur entry goes from { originalUrl } to { type, images: [{ url, localImage }] }.
async function _cacheCommentImgur(appid, postId, comments) {
    if (!comments?.length) return;
    for (const comment of comments) {
        for (let i = 0; i < (comment.imgur ?? []).length; i++) {
            const entry = comment.imgur[i];
            if (entry.images || entry.failed) continue; // already resolved

            const resolved = await resolveImgurUrl(entry.originalUrl).catch(() => null);
            if (!resolved) { entry.failed = true; continue; }

            entry.type   = resolved.type;
            entry.images = [];
            await fs.mkdir(imagesDir(appid), { recursive: true });

            for (let j = 0; j < resolved.images.length; j++) {
                const img      = resolved.images[j];
                const ext      = _imageExt(img.url);
                const filename = `${postId}_im_${comment.id}_${i}_${j}${ext}`;
                const dest     = path.join(imagesDir(appid), filename);
                const localUrl = `/images/reddit/${appid}/${filename}`;
                const ok       = await _cacheFile(dest, img.url, 'imgur-image');
                entry.images.push({ url: img.url, localImage: ok ? localUrl : null });
            }
            logger.debug('[reddit] Imgur resolved', { url: entry.originalUrl, type: entry.type, images: entry.images.length });
        }
        if (comment.replies?.length) await _cacheCommentImgur(appid, postId, comment.replies);
    }
}

// Cache Giphy GIF embeds in comments as MP4 (far smaller than raw GIF).
async function _cacheCommentGifs(appid, postId, comments) {
    if (!comments?.length) return;
    await fs.mkdir(videosDir(appid), { recursive: true });
    for (const comment of comments) {
        for (let i = 0; i < (comment.gifs ?? []).length; i++) {
            const gif = comment.gifs[i];
            if (gif.localVideo) continue;
            const filename = `${postId}_g_${comment.id}_${i}.mp4`;
            const dest     = path.join(videosDir(appid), filename);
            const localUrl = `/videos/reddit/${appid}/${filename}`;
            const ok = await _cacheFile(dest, `https://media.giphy.com/media/${gif.id}/giphy.mp4`, 'giphy-mp4');
            if (ok) gif.localVideo = localUrl;
        }
        if (comment.replies?.length) await _cacheCommentGifs(appid, postId, comment.replies);
    }
}

// Cache images embedded in comments (uploaded via Reddit's inline image feature).
// Walks the comment tree recursively; mutates each image entry with localImage.
async function _cacheCommentImages(appid, postId, comments) {
    if (!comments?.length) return;
    await fs.mkdir(imagesDir(appid), { recursive: true });
    for (const comment of comments) {
        for (let i = 0; i < (comment.images ?? []).length; i++) {
            const img = comment.images[i];
            if (img.localImage) continue; // already cached
            const ext      = _imageExt(img.url);
            const filename = `${postId}_c_${comment.id}_${i}${ext}`;
            const dest     = path.join(imagesDir(appid), filename);
            const localUrl = `/images/reddit/${appid}/${filename}`;
            const ok = await _cacheFile(dest, img.url, 'comment-image');
            if (ok) img.localImage = localUrl;
        }
        if (comment.replies?.length) await _cacheCommentImages(appid, postId, comment.replies);
    }
}

// ── Image helpers ─────────────────────────────────────────────────────────────

const IMG_GAP_MIN_MS = 300;
const IMG_GAP_MAX_MS = 800;
function imgJitter() { return IMG_GAP_MIN_MS + Math.random() * (IMG_GAP_MAX_MS - IMG_GAP_MIN_MS); }

// Cache displayable media for a post list. For video posts only the thumbnail
// (poster image) is cached here — the full video is lazily cached on thread open.
async function _cacheMediaPosts(appid, posts) {
    let first = true;
    for (const post of posts) {
        const gallery    = post.isGallery ? (post.galleryImages ?? []) : [];
        const fullUrl    = !post.isGallery && !post.isVideo ? (post.isImage ? post.imageUrl : (post.previewUrl ?? null)) : null;
        const needsFull  = !!fullUrl;
        const needsThumb = !!post.thumbnail;
        const needsGallery = gallery.some(g => !g.localImage);
        if (!needsFull && !needsThumb && !needsGallery) continue;

        if (!first) await sleep(imgJitter());
        first = false;

        if (needsGallery) {
            for (let i = 0; i < gallery.length; i++) {
                const gimg = gallery[i];
                if (gimg.localImage) continue;
                const local = await cacheGalleryImage(appid, post.id, i, gimg.url);
                if (local) gimg.localImage = local;
                if (i < gallery.length - 1) await sleep(imgJitter());
            }
        }
        if (needsFull) {
            if (needsGallery) await sleep(imgJitter());
            const local = await cacheImage(appid, post.id, fullUrl);
            if (local) post.localImage = local;
        }
        if (needsThumb) {
            if (needsFull || needsGallery) await sleep(imgJitter());
            const local = await cacheThumb(appid, post.id, post.thumbnail);
            if (local) post.localThumb = local;
        }
    }
}

async function _cacheSharedMediaPosts(subreddit, posts) {
    let first = true;
    for (const post of posts) {
        const gallery    = post.isGallery ? (post.galleryImages ?? []) : [];
        const fullUrl    = !post.isGallery && !post.isVideo ? (post.isImage ? post.imageUrl : (post.previewUrl ?? null)) : null;
        const needsFull  = !!fullUrl;
        const needsThumb = !!post.thumbnail;
        const needsGallery = gallery.some(g => !g.localImage);
        if (!needsFull && !needsThumb && !needsGallery) continue;

        if (!first) await sleep(imgJitter());
        first = false;

        if (needsGallery) {
            for (let i = 0; i < gallery.length; i++) {
                const gimg = gallery[i];
                if (gimg.localImage) continue;
                const local = await cacheSharedGalleryImage(subreddit, post.id, i, gimg.url);
                if (local) gimg.localImage = local;
                if (i < gallery.length - 1) await sleep(imgJitter());
            }
        }
        if (needsFull) {
            if (needsGallery) await sleep(imgJitter());
            const local = await cacheSharedImage(subreddit, post.id, fullUrl);
            if (local) post.localImage = local;
        }
        if (needsThumb) {
            if (needsFull || needsGallery) await sleep(imgJitter());
            const local = await cacheSharedThumb(subreddit, post.id, post.thumbnail);
            if (local) post.localThumb = local;
        }
    }
}

// ── Post accumulation ───────────────────────────────────────────────────────────
// Feeds accumulate over time: previously-cached posts are retained and merged with
// each fresh fetch, so a subreddit's community feed grows day-over-day instead of
// being replaced wholesale by the current top-N snapshot.

function _mergeGallery(prev, next) {
    if (!next?.length) return prev ?? [];
    if (!prev?.length) return next;
    return next.map((g, i) => ({ ...g, localImage: prev[i]?.localImage ?? g.localImage }));
}

// Merge fresh posts into the existing cache. Fresh data wins for mutable fields
// (score, comment count); cached local-media paths are preserved. Posts absent from
// the fresh fetch are kept (that's the accumulation). Result is newest-first,
// capped at MAX_STORED_POSTS.
export function mergePosts(existing, fresh) {
    const byId = new Map();
    for (const p of existing ?? []) byId.set(p.id, p);
    for (const p of fresh) {
        const prev = byId.get(p.id);
        byId.set(p.id, prev ? {
            ...p,
            localImage:    prev.localImage ?? p.localImage,
            localThumb:    prev.localThumb ?? p.localThumb,
            localVideo:    prev.localVideo ?? p.localVideo,
            galleryImages: _mergeGallery(prev.galleryImages, p.galleryImages),
        } : p);
    }
    return [...byId.values()]
        .sort((a, b) => (b.createdUtc ?? 0) - (a.createdUtc ?? 0))
        .slice(0, MAX_STORED_POSTS);
}

// Shape + filter a raw listing, cache media for only the genuinely-new posts (so
// re-syncs don't re-walk media for the whole accumulated feed), then merge.
//
// Returns the merged posts alongside `added` — the count of posts we had never
// seen. That count is what the dashboard charts as new information; the merged
// length would just report the size of the accumulated feed.
async function _accumulate(existing, raw, cacheMediaFn) {
    const fresh       = raw.filter(shouldInclude).map(shapePost);
    const existingIds = new Set((existing ?? []).map(p => p.id));
    const newPosts    = fresh.filter(p => !existingIds.has(p.id));
    await cacheMediaFn(newPosts);
    return { posts: mergePosts(existing, fresh), added: newPosts.length };
}

async function _fetchSharedSub(subreddit, { force = false } = {}) {
    await fs.mkdir(sharedSubsDir(), { recursive: true });

    const cached = await getSharedSub(subreddit);
    if (!force && cached) {
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        if (age < CACHE_TTL_MS) {
            logger.debug('[reddit] Shared sub cache hit', { subreddit, posts: cached.posts.length });
            return cached;
        }
    }

    logger.info('[reddit] Fetching shared sub', { subreddit, force });
    const raw = await fetchSubredditMulti(subreddit);
    const { posts, added } = await _accumulate(cached?.posts, raw, p => _cacheSharedMediaPosts(subreddit, p));

    const entry = { subreddit, fetchedAt: new Date().toISOString(), posts };
    await fs.writeFile(sharedSubPath(subreddit), JSON.stringify(entry, null, 2));
    logger.info('[reddit] Shared sub synced', { subreddit, posts: posts.length, added });
    // `added` rides alongside the entry for the caller's novelty count; it is
    // deliberately not part of what was just written to disk.
    return { ...entry, added };
}

// ── Subreddit validation ──────────────────────────────────────────────────────

export async function validateSubreddit(name) {
    const url  = `${REDDIT_BASE}/r/${name}/about.json?raw_json=1`;
    const data = await browserGet(url);
    if (data?.kind !== 't5') return { valid: false };
    return { valid: true, name: data.data.display_name, subscribers: data.data.subscribers };
}

// ── Core ──────────────────────────────────────────────────────────────────────

// Returns the persistable source object separately from `added`, so the novelty
// counter never leaks into the entry file written by _syncGame.
async function _fetchGameSub(appid, subreddit, existing) {
    const raw = await fetchSubredditMulti(subreddit);
    const { posts, added } = await _accumulate(existing, raw, p => _cacheMediaPosts(appid, p));
    return { source: { subreddit, posts }, added };
}

// Guards against concurrent syncs of the same game (pin tick vs. daily job vs.
// on-demand page load) racing on the same entry file over the network share.
const _inFlight = new Set();

export async function syncGame(appid, gameName, { force = false } = {}) {
    const key = String(appid);
    if (_inFlight.has(key)) {
        logger.info('[reddit] syncGame skipped — already in flight', { appid });
        _emit(appid, { type: 'done' });
        return { skipped: true, entry: await getEntry(appid) };
    }
    _inFlight.add(key);
    try {
        return await _syncGame(appid, gameName, { force });
    } finally {
        _inFlight.delete(key);
    }
}

async function _syncGame(appid, gameName, { force = false } = {}) {
    logger.info('[reddit] syncGame entered', { appid, gameName, force });
    await fs.mkdir(redditDir(), { recursive: true });

    // User-configured subreddits for this game
    const userSubs = await _getUserSubreddits(appid);
    const cached   = await getEntry(appid);

    if (!force && cached) {
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        if (age < CACHE_TTL_MS) {
            // Check if any user-configured subs are missing from the cached sources
            const syncedSubs = new Set((cached.sources ?? []).map(s => s.subreddit.toLowerCase()));
            const newSubs    = userSubs.filter(s => !syncedSubs.has(s.toLowerCase()));
            if (newSubs.length === 0) {
                _emit(appid, { type: 'done' });
                return { skipped: true, entry: cached };
            }

            // Partial sync — fetch only the new subreddits and merge into cached entry
            logger.info('[reddit] Partial sync — new subreddits detected', { appid, newSubs });
            for (const sub of newSubs) {
                _emit(appid, { type: 'status', message: `Fetching r/${sub}…` });
                try {
                    const shared = await _fetchSharedSub(sub);
                    cached.sources.push({ subreddit: sub, shared: true, postCount: shared.posts.length });
                    logger.debug('[reddit] Fetched new user sub (shared)', { subreddit: sub, posts: shared.posts.length });
                } catch (err) {
                    logger.warn('[reddit] New user sub fetch failed', { subreddit: sub, err: err.message });
                }
                await sleep(jitter());
            }
            cached.fetchedAt = new Date().toISOString();
            await fs.writeFile(entryPath(appid), JSON.stringify(cached, null, 2));
            _emit(appid, { type: 'done' });
            return { skipped: false, partial: true, entry: cached };
        }
    }

    // Prior inline posts (non-shared sources) keyed by subreddit, for accumulation
    // on full re-fetch. Shared sources accumulate inside their own shared cache.
    const priorPosts = {};
    for (const s of cached?.sources ?? []) {
        if (!s.shared && s.posts) priorPosts[s.subreddit.toLowerCase()] = s.posts;
    }

    // 1. Discover game-specific subreddit from IGDB
    _emit(appid, { type: 'status', message: 'Looking up game subreddit…' });
    const gameSubreddit = await getSubreddit(appid, gameName).catch(() => null);

    const sources = [];
    let created = 0;   // posts across all subs that we had never seen before

    // The entry below is rebuilt from scratch and written unconditionally, so any
    // source whose fetch throws this cycle (IGDB discovery failure, Reddit bot-
    // detection on a search/listing) would simply vanish — overwriting a good cached
    // entry (and its accumulated posts) with fewer/empty sources. Seed a lookup of the
    // previously-stored source block per subreddit so a failed fetch can fall back to
    // its last-good block instead of dropping the source.
    const priorSourceBySub = new Map();
    for (const s of cached?.sources ?? []) {
        if (s?.subreddit) priorSourceBySub.set(s.subreddit.toLowerCase(), s);
    }
    const hasSource   = (sub) => !!sub && sources.some(s => s.subreddit?.toLowerCase() === sub.toLowerCase());
    const reuseSource = (sub) => {
        if (!sub) return;
        const prior = priorSourceBySub.get(sub.toLowerCase());
        if (prior && !hasSource(sub)) sources.push(prior);
    };

    // 2. IGDB game subreddit — multi-sort, accumulated
    if (gameSubreddit) {
        _emit(appid, { type: 'status', message: `Fetching r/${gameSubreddit}…` });
        try {
            const { source, added } = await _fetchGameSub(appid, gameSubreddit, priorPosts[gameSubreddit.toLowerCase()]);
            sources.push(source);
            created += added;
            logger.debug('[reddit] Fetched game sub', { subreddit: gameSubreddit, posts: source.posts.length, added });
        } catch (err) {
            logger.warn('[reddit] Game sub fetch failed', { subreddit: gameSubreddit, err: err.message });
            reuseSource(gameSubreddit);   // keep the last-good block on a transient fetch failure
        }
        await sleep(jitter());
    } else {
        // IGDB discovery returned null — indistinguishable between "this game genuinely
        // has no subreddit" and "IGDB glitched this cycle". Re-use the previously-
        // discovered game sub block (if any) rather than silently dropping it.
        reuseSource(cached?.subreddit);
    }

    // 3. User-configured subreddits — shared multi-sort cache (skip any already covered by IGDB)
    const igdbSubLower = gameSubreddit?.toLowerCase() ?? '';
    for (const sub of userSubs) {
        if (sub.toLowerCase() === igdbSubLower) continue; // avoid duplicate
        if (hasSource(sub)) continue;                     // already carried (e.g. a reused prior block)
        _emit(appid, { type: 'status', message: `Fetching r/${sub}…` });
        try {
            const shared = await _fetchSharedSub(sub, { force });
            sources.push({ subreddit: sub, shared: true, postCount: shared.posts.length });
            created += shared.added ?? 0;
            logger.debug('[reddit] Linked shared sub', { subreddit: sub, posts: shared.posts.length });
        } catch (err) {
            logger.warn('[reddit] User sub fetch failed', { subreddit: sub, err: err.message });
            reuseSource(sub);   // preserve the prior block rather than dropping the source
        }
        await sleep(jitter());
    }

    // 4. r/pcgaming and r/games — search by game name, accumulated
    for (const sub of ['pcgaming', 'games']) {
        _emit(appid, { type: 'status', message: `Searching r/${sub} for "${gameName}"…` });
        try {
            const raw = await fetchSearch(sub, gameName);
            const { posts, added } = await _accumulate(priorPosts[sub.toLowerCase()], raw, p => _cacheMediaPosts(appid, p));
            sources.push({ subreddit: sub, posts });
            created += added;
            logger.debug('[reddit] Fetched search', { subreddit: sub, posts: posts.length, added });
        } catch (err) {
            // fetchSearch → redditGetListing throws on bot-detection (json.error). Don't
            // drop the source: reuse the prior stored block so the accumulated posts survive.
            logger.warn('[reddit] Search failed', { subreddit: sub, err: err.message });
            reuseSource(sub);
        }
        await sleep(jitter());
    }

    const entry = {
        appid:      Number(appid),
        gameName,
        subreddit:  gameSubreddit ?? cached?.subreddit ?? null,
        fetchedAt:  new Date().toISOString(),
        sources,
    };

    await fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2));
    logger.info('[reddit] Synced', {
        appid, gameName, sources: sources.length, created,
        total: sources.reduce((n, s) => n + (s.posts?.length ?? s.postCount ?? 0), 0),
    });
    _emit(appid, { type: 'done' });

    return { skipped: false, partial: false, entry, created };
}

// ── Pin refresh ───────────────────────────────────────────────────────────────

/**
 * Called by the pin poller on each tick. Forces a full re-fetch (bypassing the
 * 6-hour TTL), merges the result with the existing cache so cached local media
 * paths are preserved, writes a `mergedAt` timestamp, and returns the count of
 * posts that are genuinely new since the previous fetch.
 */
export async function refreshForPin(appid, gameName) {
    logger.info('[reddit:pin] refreshForPin start', { appid, gameName });
    const before = await getEntry(appid);
    const knownIds = new Set(
        (before?.sources ?? []).flatMap(s => (s.posts ?? []).map(p => p.id))
    );
    logger.info('[reddit:pin] calling syncGame', { appid, knownIds: knownIds.size });
    await syncGame(appid, gameName, { force: true });
    logger.info('[reddit:pin] syncGame returned', { appid });

    // Stamp mergedAt so the frontend can detect a content change without
    // comparing full post lists.
    const fresh = await getEntry(appid);
    if (fresh) {
        fresh.mergedAt = new Date().toISOString();
        await fs.writeFile(entryPath(appid), JSON.stringify(fresh, null, 2));
    }

    const freshIds = new Set(
        (fresh?.sources ?? []).flatMap(s => (s.posts ?? []).map(p => p.id))
    );
    const newCount = [...freshIds].filter(id => !knownIds.has(id)).length;

    logger.info('[reddit] Pin refresh complete', { appid, gameName, newPosts: newCount });
    return { newCount };
}

// ── Daily background sync ────────────────────────────────────────────────────────
// Keeps community feeds fresh for games the user actually cares about, so posts
// accumulate day-over-day without needing an active play session or a page visit.

function _sessionsPath() { return path.join(featureDir('steam'), 'sessions.json'); }
function _flagsPath()    { return path.join(process.env.DATA_DIR, 'gaming-journal', 'flags.json'); }

// Games played within DAILY_RECENT_DAYS or flagged in-progress.
async function _dailySyncTargets() {
    const [sessions, flags] = await Promise.all([
        readJson(_sessionsPath()),
        readJson(_flagsPath()),
    ]);
    const cutoff  = Date.now() - DAILY_RECENT_DAYS * 24 * 3_600_000;
    const targets = new Set();

    for (const [appid, entry] of Object.entries(sessions ?? {})) {
        const list   = entry.sessions ?? [];
        const latest = list.reduce((best, s) => {
            const t = s.endedAt ?? s.startedAt ?? '';
            return t > best ? t : best;
        }, '');
        if (latest && new Date(latest).getTime() >= cutoff) targets.add(Number(appid));
    }
    for (const [appid, flag] of Object.entries(flags ?? {})) {
        if (flag?.inProgress) targets.add(Number(appid));
    }
    return [...targets];
}

/** Exported for the admin trigger; the scheduler calls it through tracked(). */
export async function runDailySync({ onProgress } = {}) {
    return _runDailySync(onProgress);
}

async function _runDailySync(onProgress) {
    const appids = await _dailySyncTargets();
    if (!appids.length) {
        logger.info('[reddit] Daily sync — no target games');
        return { fetched: 0, skipped: 0, failed: 0, total: 0 };
    }

    // Report 0% up front so the dashboard can draw a determinate meter: this
    // loop paces itself between games and runs for minutes.
    onProgress?.(0, appids.length);

    const games    = await getAllGames().catch(() => []);
    const nameById = new Map(games.map(g => [g.appid, g.name]));

    logger.info('[reddit] Daily sync starting', { games: appids.length });
    let synced = 0, skipped = 0, failed = 0, created = 0;
    for (let i = 0; i < appids.length; i++) {
        const appid = appids[i];
        const name  = nameById.get(appid);
        if (!name) { skipped++; onProgress?.(i + 1, appids.length); continue; }
        try {
            const result = await syncGame(appid, name, { force: true });
            created += result?.created ?? 0;
            synced++;
        } catch (err) {
            failed++;
            logger.warn('[reddit] Daily sync game failed', { appid, err: err.message });
        }
        onProgress?.(i + 1, appids.length);
        if (i < appids.length - 1) {
            await sleep(GAME_GAP_MIN_MS + Math.random() * (GAME_GAP_MAX_MS - GAME_GAP_MIN_MS));
        }
    }
    logger.info('[reddit] Daily sync complete', { synced, skipped, failed, created, total: appids.length });
    // `fetched` counts games re-crawled; `created` counts posts we had never
    // seen. Only the latter is new information.
    return { fetched: synced, created, skipped, failed, total: appids.length };
}

let _dailyTimer = null;

/** Starts the daily community-feed refresh. Called once on server startup. */
export function startRedditSyncScheduler() {
    const hours = parseInt(process.env.REDDIT_SYNC_INTERVAL_HOURS ?? '24', 10);
    const ms    = hours * 3_600_000;
    logger.info('[reddit] Daily sync scheduler started', { intervalHours: hours });
    _dailyTimer = setTimeout(function run() {
        tracked('reddit', () => _runDailySync()).catch(err => logger.error('[reddit] Daily sync failed', err));
        _dailyTimer = setTimeout(run, ms);
    }, DAILY_STARTUP_DELAY_MS);
}
