import path   from 'node:path';
import fs     from 'node:fs/promises';
import logger from '../../logger.js';

// Server-persisted per-map viewer preferences — which marker layers are switched on
// and which filter groups are collapsed. Stored alongside the user's other journal
// data (guide-pins.json, flags.json) rather than inside the scraped map tree, so a
// re-download or a cleanup of _maps/ can never take a user's filters with it.
//
// Keyed per MAP, not per guide: a game can ship several maps (Starfield has 13) and
// their layer sets are unrelated.

function prefsPath() { return path.join(process.env.DATA_DIR, 'gaming-journal', 'guide-map-prefs.json'); }
function keyFor(steamId, source, guideId, mapSlug) { return `${steamId}:${source}:${guideId}:${mapSlug}`; }

async function loadAll() {
    try { return JSON.parse(await fs.readFile(prefsPath(), 'utf8')); }
    catch (err) {
        if (err.code === 'ENOENT') return {};   // nothing saved yet — empty is correct
        // Transient read/parse error: rethrow so a read-modify-write aborts rather than
        // treating the store as empty and clobbering every other map's saved filters.
        throw err;
    }
}

async function saveAll(data) {
    await fs.mkdir(path.dirname(prefsPath()), { recursive: true });
    await fs.writeFile(prefsPath(), JSON.stringify(data, null, 2));
}

// Serialise read-modify-write, same reason as guide-pins: two tabs (or web + native)
// saving at once must not clobber each other. Both hit this single process.
let _chain = Promise.resolve();
function withLock(fn) {
    const run = _chain.then(fn, fn);
    _chain = run.then(() => {}, () => {});
    return run;
}

/** Slug arrays only — reject anything that isn't a list of non-empty strings. */
function cleanSlugs(value) {
    if (!Array.isArray(value)) return null;
    const out = [...new Set(value.map(String).filter(s => s.length > 0 && s.length <= 64))];
    return out.length <= 500 ? out : out.slice(0, 500);
}

/**
 * Saved prefs for one map.
 *
 * `enabled: null` means "never saved" — distinct from an empty array, which is a user
 * who deliberately switched every layer off. The client needs that difference: null
 * falls back to IGN's own defaults, [] must be honoured as-is.
 */
export async function getMapPrefs(steamId, source, guideId, mapSlug) {
    const all   = await loadAll();
    const entry = all[keyFor(steamId, source, guideId, mapSlug)];
    return {
        enabled:         entry?.enabled ?? null,
        collapsedGroups: entry?.collapsedGroups ?? [],
        updatedAt:       entry?.updatedAt ?? null,
    };
}

export function setMapPrefs(steamId, source, guideId, mapSlug, { enabled = null, collapsedGroups = [] } = {}) {
    return withLock(async () => {
        const all = await loadAll();
        const key = keyFor(steamId, source, guideId, mapSlug);

        const cleanEnabled   = cleanSlugs(enabled);
        const cleanCollapsed = cleanSlugs(collapsedGroups) ?? [];

        // A null `enabled` is a malformed write, not "reset to defaults" — drop it rather
        // than persisting a state the client can't distinguish from never-saved.
        if (cleanEnabled === null) throw new Error('enabled must be an array of type slugs');

        all[key] = {
            enabled:         cleanEnabled,
            collapsedGroups: cleanCollapsed,
            updatedAt:       new Date().toISOString(),
        };
        await saveAll(all);
        logger.info('[guide-map-prefs] set', {
            steamId, source, guideId, mapSlug,
            enabled: cleanEnabled.length, collapsed: cleanCollapsed.length,
        });
        return all[key];
    });
}
