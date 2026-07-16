import logger       from '../../logger.js';
import { browserEval } from '../browser/browser.service.js';

// Determine the type and key identifiers from an imgur URL.
function parseImgurUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { return null; }

    const parts = u.pathname.split('/').filter(Boolean);

    // i.imgur.com/abc123.jpg — direct CDN image, no scraping needed
    if (u.hostname === 'i.imgur.com') {
        return { type: 'direct', directUrl: raw };
    }

    // imgur.com/a/{albumId} or imgur.com/gallery/{albumId}
    if (parts[0] === 'a' || parts[0] === 'gallery') {
        const albumId = parts[1]?.split('#')[0];
        if (!albumId) return null;
        return { type: 'album', albumId, url: `https://imgur.com/${parts[0]}/${albumId}` };
    }

    // imgur.com/{imageId} — single image page
    const imageId = parts[0]?.replace(/\.[^.]+$/, '');
    if (!imageId) return null;
    return { type: 'single', imageId };
}

// Scrape all full-size image URLs from an imgur album page.
async function scrapeAlbum(albumUrl) {
    logger.info('[imgur] Scraping album', { url: albumUrl });

    const urls = await browserEval(albumUrl, () => {
        const seen = new Set();
        const results = [];

        // Collect every img src that points to i.imgur.com
        document.querySelectorAll('img').forEach(img => {
            for (const src of [img.src, img.dataset.src].filter(Boolean)) {
                // Match direct imgur CDN images: i.imgur.com/{id}.{ext}
                // Exclude tracking pixels and tiny icons by requiring the path
                // to look like an image ID (no path separators after the host)
                const m = src.match(/https?:\/\/i\.imgur\.com\/([^/?#]+\.(?:jpe?g|png|gif|webp|mp4))/i);
                if (!m) continue;
                const canonical = `https://i.imgur.com/${m[1]}`;
                if (!seen.has(canonical)) { seen.add(canonical); results.push(canonical); }
            }
        });

        return results;
    }, { waitMs: 3000 });

    logger.info('[imgur] Album scraped', { url: albumUrl, images: urls.length });
    return urls;
}

// Resolve a single imgur image page to a direct CDN URL.
// imgur.com/{id} → i.imgur.com/{id}.jpg (derived by convention; falls back to scraping).
async function resolveSinglePage(imageId, originalUrl) {
    // Try the derived direct URL first — works for most image types
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'mp4']) {
        const candidate = `https://i.imgur.com/${imageId}.${ext}`;
        try {
            const res = await fetch(candidate, { method: 'HEAD' });
            if (res.ok) return [candidate];
        } catch { /* continue */ }
    }

    // Fall back to scraping the page
    logger.info('[imgur] Single image HEAD checks failed — scraping page', { imageId });
    const urls = await browserEval(originalUrl, () => {
        const seen = new Set();
        const results = [];
        document.querySelectorAll('img').forEach(img => {
            const src = img.src || img.dataset.src;
            const m = src?.match(/https?:\/\/i\.imgur\.com\/([^/?#]+\.(?:jpe?g|png|gif|webp|mp4))/i);
            if (!m) return;
            const canonical = `https://i.imgur.com/${m[1]}`;
            if (!seen.has(canonical)) { seen.add(canonical); results.push(canonical); }
        });
        return results;
    }, { waitMs: 2000 });

    return urls;
}

// Resolve an imgur URL to a list of direct image URLs.
// Returns { type: 'image'|'album', images: [{ url }] } or null on failure.
export async function resolveImgurUrl(originalUrl) {
    const parsed = parseImgurUrl(originalUrl);
    if (!parsed) return null;

    try {
        if (parsed.type === 'direct') {
            return { type: 'image', images: [{ url: parsed.directUrl }] };
        }

        if (parsed.type === 'album') {
            const urls = await scrapeAlbum(parsed.url);
            if (!urls.length) return null;
            return { type: 'album', images: urls.map(url => ({ url })) };
        }

        if (parsed.type === 'single') {
            const urls = await resolveSinglePage(parsed.imageId, originalUrl);
            if (!urls.length) return null;
            return { type: 'image', images: urls.map(url => ({ url })) };
        }
    } catch (err) {
        logger.warn('[imgur] Resolution failed', { url: originalUrl, err: err.message });
        return null;
    }
}
