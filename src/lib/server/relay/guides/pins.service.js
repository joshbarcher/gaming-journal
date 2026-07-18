import path   from 'node:path';
import fs     from 'node:fs/promises';
import logger from '../../logger.js';
import { featureDir } from '../shared/data-root.js';

// Server-persisted guide TOC pins — the shared source of truth for the web app and the native app.
// Stored alongside the user's other journal data (flags, reddit-subreddits) keyed by guide.

function pinsPath() { return path.join(process.env.DATA_DIR, 'gaming-journal', 'guide-pins.json'); }
function keyFor(steamId, source, guideId) { return `${steamId}:${source}:${guideId}`; }

// A guide's data dir (holds _meta.json, _fulltext.json, per-section content.json). Uses the
// same root the guides controller reads — RELAY_DATA_ROOT-aware, so this resolves to the
// tree prod actually serves. NOTE this differs from pinsPath()'s DATA_DIR/gaming-journal base.
function guideDataDir(steamId, source, guideId) {
    return path.join(featureDir('guides'), String(steamId), source, guideId);
}

async function readGuideParsedAt(steamId, source, guideId) {
    try {
        const raw = await fs.readFile(path.join(guideDataDir(steamId, source, guideId), '_meta.json'), 'utf8');
        return JSON.parse(raw).parsedAt ?? null;
    } catch { return null; }   // no meta / unreadable — treat as "unknown", skip reconcile
}

async function loadFulltext(steamId, source, guideId) {
    try {
        const raw = await fs.readFile(path.join(guideDataDir(steamId, source, guideId), '_fulltext.json'), 'utf8');
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : null;
    } catch { return null; }
}

// ── Re-anchoring (content-addressed pins) ───────────────────────────────────────
// A pin stores a positional blockPath plus a text `label`. Across a re-parse the blockPath
// can shift, but the text usually survives, so we re-locate each pin by matching its label
// against _fulltext.json — which maps every block to {slug, text, blockPath} in the SAME
// coordinate resolveBlockPath() uses on the client. blockPath becomes a hint; text is identity.

// Trailing ellipsis (extractLabel truncates to 70 chars + "…") and native type-prefixes
// ("List: ", "Table", …) are stripped so labels from either surface compare cleanly.
function normLabel(s) {
    return String(s ?? '')
        .replace(/(…|\.\.\.)\s*$/, '')
        .replace(/^(list|table|image|jump ?links)\s*:\s*/i, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// Positional distance between two blockPaths — 0 for identical, small for nearby. Used only
// as a tie-breaker so an unchanged block re-anchors to itself and moved blocks prefer the
// closest match.
function pathDist(a = [], b = []) {
    const n = Math.max(a.length, b.length);
    let d = 0;
    for (let i = 0; i < n; i++) d += Math.abs((a[i] ?? 999) - (b[i] ?? 999));
    return d;
}

function lexLess(x, y) {
    for (let i = 0; i < x.length; i++) {
        if (x[i] < y[i]) return true;
        if (x[i] > y[i]) return false;
    }
    return false;
}

// Best fulltext blockPath for a normalized label among one page's candidates, or null.
// Tiers: exact text > text startsWith label > text contains label (list/table rows). Ties
// break by closeness to the old path, then by shortest text (most specific block).
function bestBlockPath(label, candidates, oldPath) {
    let best = null, bestScore = null;
    for (const c of candidates) {
        let tier;
        if (c.norm === label)             tier = 0;
        else if (c.norm.startsWith(label)) tier = 1;
        else if (c.norm.includes(label))   tier = 2;
        else continue;
        const score = [tier, pathDist(oldPath, c.blockPath), c.norm.length];
        if (bestScore === null || lexLess(score, bestScore)) { bestScore = score; best = c.blockPath; }
    }
    return best;
}

// Pure re-anchor: given pins and a guide's _fulltext entries, return pins with blockPath
// updated where a confident text match exists; pins with no match are returned unchanged
// (the client flags them "location not found" — we never drop a pin here). Exported for tests.
export function reanchorPinList(pins, fulltextEntries) {
    const bySlug = new Map();
    for (const e of fulltextEntries ?? []) {
        if (!e || typeof e.text !== 'string' || !Array.isArray(e.blockPath)) continue;
        const slug = String(e.slug ?? '').split('#')[0];
        if (!bySlug.has(slug)) bySlug.set(slug, []);
        bySlug.get(slug).push({ norm: normLabel(e.text), blockPath: e.blockPath });
    }
    return pins.map(pin => {
        const label = normLabel(pin.label);
        if (!label) return pin;                                   // no text to match on
        const cands = bySlug.get(String(pin.slug).split('#')[0]) ?? [];
        const bp = bestBlockPath(label, cands, pin.blockPath);
        return bp ? { ...pin, blockPath: bp } : pin;
    });
}

async function reanchorEntry(entry, steamId, source, guideId, currentParsedAt) {
    const fulltext = await loadFulltext(steamId, source, guideId);
    const pins = fulltext ? reanchorPinList(entry.pins, fulltext) : entry.pins;
    return { parsedAt: currentParsedAt, pins };
}

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
    const key   = keyFor(steamId, source, guideId);
    const all   = await loadAll();   // throws on a transient read error → route 500s (unchanged)
    const entry = all[key];

    // Fast path: no pins, or the guide hasn't been re-parsed since these pins were anchored.
    if (!entry?.pins?.length) return entry ?? { parsedAt: null, pins: [] };
    const currentParsedAt = await readGuideParsedAt(steamId, source, guideId);
    if (!currentParsedAt || !entry.parsedAt || entry.parsedAt === currentParsedAt) {
        logger.info('[guide-pins] get', { steamId, source, guideId, count: entry.pins.length });
        return entry;
    }

    // Guide re-parsed → re-anchor the pins to the new content by text, then persist so the
    // heal is one-time. Lock the read-modify-write; double-check inside in case a concurrent
    // request already reconciled.
    return withLock(async () => {
        const all2  = await loadAll();
        const cur   = all2[key];
        if (!cur?.pins?.length)               return cur ?? { parsedAt: null, pins: [] };
        if (cur.parsedAt === currentParsedAt) return cur;

        const healed = await reanchorEntry(cur, steamId, source, guideId, currentParsedAt);
        all2[key] = healed;
        await saveAll(all2);
        logger.info('[guide-pins] reanchored', { steamId, source, guideId, count: healed.pins.length });
        return healed;
    });
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

        // Merge into whatever is stored — never drop prior pins on a re-parse. Keep the
        // store's existing parsedAt (the coordinate the prior pins were anchored at) so the
        // next getPins reconciles the whole set to the current parse by text; adopt the
        // incoming parsedAt only when there was nothing stored yet.
        const prior = entry.pins;

        // Drop any existing pin for this page or reusing this id, then append the newcomer.
        const pins = prior
            .filter(p => p.id !== clean.id && p.slug.split('#')[0] !== baseSlug)
            .concat(clean);

        all[key] = { parsedAt: entry.parsedAt ?? parsedAt ?? null, pins };
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
