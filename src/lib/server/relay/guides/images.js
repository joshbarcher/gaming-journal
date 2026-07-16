/**
 * Guide image utilities — Sharp-based WebP conversion.
 *
 * Converts downloaded images to WebP sidecars (originals preserved).
 * The renderer swaps the extension at display time; localSrc in content.json
 * is never modified.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import sharp from 'sharp';

const QUALITY   = 85;
const CONVERTIBLE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.avif']);

/**
 * Convert a single image file to a WebP sidecar.
 * Skips if the .webp already exists (unless force=true).
 *
 * @param {string}  srcPath  - Absolute path to the source image
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false]
 * @returns {Promise<'converted'|'skipped'|'unsupported'>}
 */
export async function convertImageToWebp(srcPath, { force = false } = {}) {
    const ext     = extname(srcPath).toLowerCase();
    if (!CONVERTIBLE.has(ext)) return 'unsupported';

    const webpPath = srcPath.slice(0, -ext.length) + '.webp';

    if (!force) {
        try {
            await stat(webpPath);
            return 'skipped';
        } catch { /* doesn't exist yet */ }
    }

    try {
        await sharp(srcPath).webp({ quality: QUALITY }).toFile(webpPath);
        return 'converted';
    } catch (err) {
        console.warn(`    [webp] Skipping ${basename(srcPath)}: ${err.message}`);
        return 'failed';
    }
}

/**
 * Convert all convertible images in an img/ directory to WebP sidecars.
 *
 * @param {string}  imgDir - Absolute path to the img/ folder
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false]
 * @returns {Promise<{ converted: number, skipped: number }>}
 */
export async function convertImgDir(imgDir, { force = false, onProgress = null } = {}) {
    let entries;
    try {
        entries = await readdir(imgDir);
    } catch {
        return { converted: 0, skipped: 0 };
    }

    let converted  = 0;
    let skipped    = 0;
    let processed  = 0;

    const convertible = entries.filter(f => CONVERTIBLE.has(extname(f).toLowerCase()));

    for (const filename of convertible) {
        const result = await convertImageToWebp(join(imgDir, filename), { force });
        if (result === 'converted') converted++;
        else if (result === 'skipped') skipped++;
        processed++;
        if (onProgress) onProgress(processed, convertible.length);
    }

    return { converted, skipped };
}
