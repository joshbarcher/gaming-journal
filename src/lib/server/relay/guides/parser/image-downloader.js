/**
 * Image downloader — fetches remote images and saves them locally.
 *
 * Checks a Puppeteer-populated _image_cache.json first (local copies saved
 * during the fetch phase). Falls back to HTTP fetch for uncached images.
 *
 * The parse tool is responsible for turning the local relative path into the
 * server-absolute URL that will appear in content.json.
 */

import { mkdir, writeFile, access, readFile, copyFile } from 'node:fs/promises';
import { join, extname }                                 from 'node:path';
import { URL }                                           from 'node:url';
import { recordWrite }                                   from '../../../../../../activity.js';

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg']);

function buildFetchHeaders(pageUrl) {
    return {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept':          'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         pageUrl,
    };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Resolve a potentially relative image URL against the page's URL
function resolveImageUrl(src, pageUrl) {
    if (!src || src.startsWith('data:')) return null;
    try {
        return new URL(src, pageUrl).href;
    } catch {
        return null;
    }
}

// Determine file extension from URL (fallback to .jpg)
function imageExt(url) {
    try {
        const { pathname } = new URL(url);
        const ext = extname(pathname).toLowerCase().split('?')[0];
        return SUPPORTED_EXTS.has(ext) ? ext : '.jpg';
    } catch {
        return '.jpg';
    }
}

/**
 * Download a single image.
 *
 * Checks the Puppeteer image cache (rawDir/_image_cache.json) first.
 * Falls back to HTTP fetch for images not in the cache.
 *
 * @param {string}  src       - Image src attribute value
 * @param {string}  pageUrl   - URL of the page the image came from (for resolving relative URLs)
 * @param {string}  imgDir    - Absolute path to the output image directory
 * @param {number}  index     - Sequence number for the filename (1-based)
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false]     - Re-download even if file already exists
 * @param {object}  [opts.fetchCache=null] - Pre-loaded _image_cache.json map {url → rawPath}
 * @param {string}  [opts.rawDir=null]     - Absolute path to _raw/ for resolving cached image paths
 * @returns {Promise<{path:string,source:'existing'|'cache'|'http'}|null>}
 */
export async function downloadImage(src, pageUrl, imgDir, index, { force = false, fetchCache = null, rawDir = null } = {}) {
    const absUrl = resolveImageUrl(src, pageUrl);
    if (!absUrl) return null;

    await mkdir(imgDir, { recursive: true });

    const seq      = String(index).padStart(3, '0');
    const ext      = imageExt(absUrl);
    const filename = `${seq}${ext}`;
    const destPath = join(imgDir, filename);

    if (!force) {
        try {
            await access(destPath);
            return { path: `img/${filename}`, source: 'existing' };
        } catch { /* not on disk yet */ }
    }

    // Check Puppeteer fetch-phase cache first (avoids auth/hotlink issues)
    if (fetchCache && rawDir && fetchCache[absUrl]) {
        const cachedSrc = join(rawDir, fetchCache[absUrl]);
        try {
            await copyFile(cachedSrc, destPath);
            return { path: `img/${filename}`, source: 'cache' };
        } catch { /* fall through to HTTP */ }
    }

    try {
        const res = await fetch(absUrl, { headers: buildFetchHeaders(pageUrl) });
        if (!res.ok) {
            console.warn(`    [img] HTTP ${res.status} — ${absUrl}`);
            // Release the socket — an unconsumed response body keeps its
            // keep-alive connection referenced and can delay process exit.
            await res.body?.cancel().catch(() => {});
            return null;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(destPath, buf);
        recordWrite(buf.length, destPath); // NAS guide image (see activity.js)
        return { path: `img/${filename}`, source: 'http' };
    } catch (err) {
        console.warn(`    [img] Failed to download ${absUrl}: ${err.message}`);
        return null;
    }
}

/**
 * Walk a ContentBlock[] and download all image blocks.
 * Mutates each ImageBlock in place: sets localSrc, clears src.
 *
 * @param {ContentBlock[]} blocks
 * @param {string}         pageUrl   - Source page URL (for resolving relative image srcs)
 * @param {string}         imgDir    - Directory to save images into
 * @param {object}         [opts]
 * @param {number}         [opts.delayMs=400]  - Delay between HTTP image downloads (ms)
 * @param {boolean}        [opts.force=false]
 * @param {string}         [opts.rawDir=null]  - Path to _raw/ dir for Puppeteer image cache lookup
 * @returns {Promise<number>} Count of images successfully saved
 */
export async function downloadImages(blocks, pageUrl, imgDir, { delayMs = 400, force = false, onlyExisting = false, rawDir = null, onProgress = null } = {}) {
    // Load Puppeteer fetch-phase image cache if available
    let fetchCache = null;
    if (rawDir) {
        try {
            const cacheJson = await readFile(join(rawDir, '_image_cache.json'), 'utf8');
            fetchCache = JSON.parse(cacheJson);
        } catch { /* no cache file — will fall back to HTTP */ }
    }

    const imageBlocks = blocks.filter(b => b.type === 'image');
    let index = 1;
    let fetched = 0;

    for (const block of imageBlocks) {
        // onlyExisting: resolve already-downloaded images but skip HTTP fetches for new ones
        const attempt = (src) => onlyExisting
            ? downloadImage(src, pageUrl, imgDir, index, { force: false, fetchCache, rawDir }).then(r => r?.source === 'existing' ? r : null)
            : downloadImage(src, pageUrl, imgDir, index, { force, fetchCache, rawDir });

        // srcFallback is a second URL for the same picture, used when the preferred one
        // isn't there. YouTube poster frames are the case: maxresdefault is the sharp,
        // un-letterboxed one but only exists for some videos, and hqdefault always does.
        let result = await attempt(block.src);
        if (!result && block.srcFallback && !onlyExisting) result = await attempt(block.srcFallback);

        if (result) {
            block.localSrc = result.path;
            if (result.source !== 'existing') {
                process.stdout.write(`    [img ${index}/${imageBlocks.length}] ${(block.src ?? '').slice(0, 60)} → ${result.path}\n`);
                fetched++;
                if (result.source === 'http' && index < imageBlocks.length) await sleep(delayMs + Math.random() * 200);
            }
            if (onProgress) onProgress(index, imageBlocks.length);
            index++;
        } else {
            block.localSrc = null;
        }
        delete block.src;
        delete block.srcFallback;
    }

    return fetched;
}
