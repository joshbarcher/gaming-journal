import path   from 'node:path';
import fs     from 'node:fs/promises';
import logger from '../../logger.js';

// Server-persisted guide TOC pins — the shared source of truth for the web app and the native app.
// Stored alongside the user's other journal data (flags, reddit-subreddits) keyed by guide.

function pinsPath() { return path.join(process.env.DATA_DIR, 'gaming-journal', 'guide-pins.json'); }
function keyFor(steamId, source, guideId) { return `${steamId}:${source}:${guideId}`; }

async function loadAll() {
    try { return JSON.parse(await fs.readFile(pinsPath(), 'utf8')); }
    catch (err) {
        if (err.code === 'ENOENT') return {};   // no pins file yet — empty is correct
        // Transient read/parse error: rethrow so a read-modify-write (set/upsert/delete)
        // aborts rather than treating the store as empty and clobbering every other tab's
        // pins with {}.
        throw err;
    }
}

async function saveAll(data) {
    await fs.mkdir(path.dirname(pinsPath()), { recursive: true });
    await fs.writeFile(pinsPath(), JSON.stringify(data, null, 2));
}

// Serialise read-modify-write so a web PUT and a native PUT arriving together can't clobber each
// other (both hit this single relay process).
let _chain = Promise.resolve();
function withLock(fn) {
    const run = _chain.then(fn, fn);
    _chain = run.then(() => {}, () => {});
    return run;
}

function isValidPin(p) {
    return p && typeof p.id === 'string' && typeof p.slug === 'string' && Array.isArray(p.blockPath);
}

function sanitizePin(p) {
    return {
        id:        String(p.id),
        slug:      String(p.slug),
        pageLabel: String(p.pageLabel ?? ''),
        blockPath: p.blockPath.map(Number).filter(n => Number.isFinite(n)),
        label:     String(p.label ?? ''),
    };
}

export async function getPins(steamId, source, guideId) {
    const all   = await loadAll();
    const entry = all[keyFor(steamId, source, guideId)];
    logger.info('[guide-pins] get', { steamId, source, guideId, count: entry?.pins?.length ?? 0 });
    return entry ?? { parsedAt: null, pins: [] };
}

export function setPins(steamId, source, guideId, { parsedAt = null, pins = [] } = {}) {
    return withLock(async () => {
        const all   = await loadAll();
        const key   = keyFor(steamId, source, guideId);
        const clean = Array.isArray(pins) ? pins.filter(isValidPin).map(sanitizePin) : [];

        if (clean.length === 0) {
            delete all[key];                                  // don't persist empty guides
        } else {
            all[key] = { parsedAt: parsedAt ?? null, pins: clean };
        }
        await saveAll(all);
        logger.info('[guide-pins] set', { steamId, source, guideId, count: clean.length });
        return all[key] ?? { parsedAt: parsedAt ?? null, pins: clean };
    });
}

// Add or replace a single pin, MERGING into whatever is currently stored rather than
// replacing the whole list. This is what keeps concurrent tabs (each holding its own
// stale snapshot) from clobbering each other's pins: every add is a server-side delta
// against the live store, not an overwrite from the client's local array.
//
// "One pin per page" is enforced by base slug: any existing pin on the same page (or with
// the same id) is dropped before the incoming one is appended. Always returns the full,
// authoritative store so the caller can reconcile its local state.
export function upsertPin(steamId, source, guideId, pin, parsedAt = null) {
    return withLock(async () => {
        if (!isValidPin(pin)) throw new Error('invalid pin');
        const clean = sanitizePin(pin);
        const baseSlug = clean.slug.split('#')[0];

        const all   = await loadAll();
        const key   = keyFor(steamId, source, guideId);
        const entry = all[key] ?? { parsedAt: parsedAt ?? null, pins: [] };

        // Guide re-downloaded since these pins were saved → old blockPaths no longer line
        // up. Start fresh under the new parse rather than mixing incompatible coordinates.
        const versionChanged =
            parsedAt != null && entry.parsedAt != null && entry.parsedAt !== parsedAt;
        const prior = versionChanged ? [] : entry.pins;

        // Drop any existing pin for this page or reusing this id, then append the newcomer.
        const pins = prior
            .filter(p => p.id !== clean.id && p.slug.split('#')[0] !== baseSlug)
            .concat(clean);

        all[key] = { parsedAt: parsedAt ?? entry.parsedAt ?? null, pins };
        await saveAll(all);
        logger.info('[guide-pins] upsert', { steamId, source, guideId, pinId: clean.id, count: pins.length });
        return all[key];
    });
}

// Remove a single pin by id, leaving every other pin (including ones added by other tabs
// this client never saw) untouched. Returns the full, authoritative store.
export function deletePin(steamId, source, guideId, pinId) {
    return withLock(async () => {
        const all   = await loadAll();
        const key   = keyFor(steamId, source, guideId);
        const entry = all[key];
        if (!entry) return { parsedAt: null, pins: [] };

        const pins = entry.pins.filter(p => p.id !== String(pinId));
        if (pins.length === 0) {
            delete all[key];                                  // don't persist empty guides
        } else {
            all[key] = { parsedAt: entry.parsedAt ?? null, pins };
        }
        await saveAll(all);
        logger.info('[guide-pins] delete', { steamId, source, guideId, pinId, count: pins.length });
        return all[key] ?? { parsedAt: entry.parsedAt ?? null, pins: [] };
    });
}
