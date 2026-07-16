// Ported verbatim from relay-server src/services/steam/featured-history.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: data paths via featureDir('steam').
import path   from 'node:path';
import fs     from 'node:fs/promises';
import logger from '../../logger.js';
import { featureDir } from '../shared/data-root.js';

const PAGE_SIZE = 24;

const TABS = [
    { id: 'new_releases', label: 'New Releases' },
    { id: 'top_sellers',  label: 'Top Sellers'  },
    { id: 'coming_soon',  label: 'Coming Soon'  },
    { id: 'specials',     label: 'On Sale'       },
];
const TAB_IDS = TABS.map(t => t.id);

// ── Paths ─────────────────────────────────────────────────────────────────────

function _historyDir() {
    return featureDir('steam');
}

function _legacyPath() {
    return path.join(_historyDir(), 'featured-history.json');
}

function _weekFilePath(weekKey) {
    return path.join(_historyDir(), `featured-${weekKey}.json`);
}

// ── Week helpers ──────────────────────────────────────────────────────────────

// Returns the ISO date string (YYYY-MM-DD) of the Monday of the week
// containing the given date (or now if omitted).
function _weekKey(date) {
    const d   = new Date(date ?? Date.now());
    const day = d.getUTCDay(); // 0 = Sun
    const daysBack = day === 0 ? 6 : day - 1;
    const mon = new Date(Date.UTC(
        d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysBack
    ));
    return [
        mon.getUTCFullYear(),
        String(mon.getUTCMonth() + 1).padStart(2, '0'),
        String(mon.getUTCDate()).padStart(2, '0'),
    ].join('-');
}

// ── In-memory state ───────────────────────────────────────────────────────────

// One Map per tab: appid (string) → entry object
const _mem = Object.fromEntries(TAB_IDS.map(id => [id, new Map()]));

// Pre-sorted entry arrays for instant paging.
// Specials: active sales only. All other tabs: full history, newest first.
let _sorted = Object.fromEntries(TAB_IDS.map(id => [id, []]));

let _ready       = false;
let _loadPromise = null;

function _buildSorted(tabId) {
    const entries = [..._mem[tabId].values()];
    // ISO strings compare lexicographically = chronologically
    entries.sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : b.lastSeen < a.lastSeen ? -1 : 0));
    _sorted[tabId] = tabId === 'specials' ? entries.filter(e => !e.saleEnded) : entries;
}

// ── Migration (one-time) ──────────────────────────────────────────────────────

async function _migrate() {
    const legacyPath = _legacyPath();
    try { await fs.access(legacyPath); } catch { return; }

    logger.info('[featured-history] Migrating monolithic file to weekly files…');
    let old;
    try {
        old = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
    } catch {
        return;
    }

    // Group entries by the Monday of their lastSeen week
    const byWeek = {};
    for (const [tabId, bucket] of Object.entries(old)) {
        if (!TAB_IDS.includes(tabId)) continue;
        for (const [appid, entry] of Object.entries(bucket)) {
            const wk = _weekKey(entry.lastSeen);
            if (!byWeek[wk]) byWeek[wk] = Object.fromEntries(TAB_IDS.map(id => [id, {}]));
            byWeek[wk][tabId][appid] = entry;
        }
    }

    const weeks = Object.keys(byWeek).sort();
    for (const wk of weeks) {
        const fp = _weekFilePath(wk);
        try {
            await fs.access(fp);
            logger.info('[featured-history] Weekly file already exists, skipping', { wk });
        } catch {
            await fs.writeFile(fp, JSON.stringify(byWeek[wk]), 'utf8');
            logger.info('[featured-history] Wrote weekly file', { wk, entries: Object.values(byWeek[wk]).reduce((n, b) => n + Object.keys(b).length, 0) });
        }
    }

    await fs.rename(legacyPath, legacyPath + '.migrated');
    logger.info('[featured-history] Migration complete — archived old file');
}

// ── Load (called once at startup) ─────────────────────────────────────────────

export async function load() {
    if (_ready) return;

    await _migrate();

    const dir = _historyDir();
    let files = [];
    try {
        files = (await fs.readdir(dir))
            .filter(f => /^featured-\d{4}-\d{2}-\d{2}\.json$/.test(f))
            .sort(); // YYYY-MM-DD lexicographic = chronological
    } catch {
        logger.warn('[featured-history] Could not read history dir', { dir });
    }

    // Merge oldest → newest so the most recent data wins per appid
    for (const file of files) {
        try {
            const raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
            for (const [tabId, bucket] of Object.entries(raw)) {
                if (!_mem[tabId]) continue;
                for (const [appid, entry] of Object.entries(bucket)) {
                    _mem[tabId].set(appid, entry);
                }
            }
        } catch {
            logger.warn('[featured-history] Skipping unreadable weekly file', { file });
        }
    }

    for (const tabId of TAB_IDS) _buildSorted(tabId);

    _ready = true;
    logger.info('[featured-history] Ready', {
        files:        files.length,
        new_releases: _mem.new_releases.size,
        top_sellers:  _mem.top_sellers.size,
        coming_soon:  _mem.coming_soon.size,
        specials:     _mem.specials.size,
    });
}

async function _ensureReady() {
    if (_ready) return;
    if (!_loadPromise) _loadPromise = load();
    return _loadPromise;
}

// ── Flush helpers ─────────────────────────────────────────────────────────────

// Write the current week's file: only entries whose lastSeen falls in this week.
async function _flushCurrentWeek() {
    const weekKey    = _weekKey();
    const thisMonday = weekKey; // "YYYY-MM-DD"

    const data = Object.fromEntries(TAB_IDS.map(id => [id, {}]));
    for (const [tabId, map] of Object.entries(_mem)) {
        for (const [appid, entry] of map) {
            if (entry.lastSeen.slice(0, 10) >= thisMonday) {
                data[tabId][appid] = entry;
            }
        }
    }
    await fs.writeFile(_weekFilePath(weekKey), JSON.stringify(data), 'utf8');
}

// Persist a single specials entry into the current week's file so that sale
// state changes survive a restart even when the entry's lastSeen is from an
// older week (and therefore not captured by _flushCurrentWeek).
async function _persistSpecialEntry(appid, entry) {
    const weekKey  = _weekKey();
    const filePath = _weekFilePath(weekKey);
    let current    = Object.fromEntries(TAB_IDS.map(id => [id, {}]));
    try {
        current = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch { /* new week, start fresh */ }
    if (!current.specials) current.specials = {};
    current.specials[String(appid)] = entry;
    await fs.writeFile(filePath, JSON.stringify(current), 'utf8');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merge a poll's sections into the history.
 *
 * Returns { created, refreshed } — items seen for the first time, versus items
 * already in the history whose lastSeen was bumped.
 *
 * `refreshed` is deliberately NOT named `updated`: the dashboard charts
 * created + updated as "new information", and a featured list that reshuffles
 * the same 60 games all week would otherwise report 1,440 new records a day
 * while telling you nothing you did not already know.
 */
export async function accumulate(sections) {
    await _ensureReady();
    const now = new Date().toISOString();

    let created = 0, refreshed = 0;

    for (const section of sections) {
        if (!_mem[section.id]) continue;
        const map = _mem[section.id];
        for (const item of section.items) {
            const key     = String(item.appid);
            const existing = map.get(key);
            if (existing) {
                existing.item     = item;
                existing.lastSeen = now;
                refreshed++;
            } else {
                const entry = { item, firstSeen: now, lastSeen: now };
                if (section.id === 'specials') {
                    entry.saleEnded  = false;
                    entry.verifiedAt = now;
                }
                map.set(key, entry);
                created++;
            }
        }
        _buildSorted(section.id);
    }

    await _flushCurrentWeek();
    logger.info('[featured-history] Accumulated', {
        created, refreshed,
        sections: sections.map(s => `${s.id}:${s.items.length}`).join(', '),
    });
    return { created, refreshed };
}

export async function markSaleEnded(appid) {
    await _ensureReady();
    const entry = _mem.specials.get(String(appid));
    if (!entry) return;
    entry.saleEnded  = true;
    entry.verifiedAt = new Date().toISOString();
    _buildSorted('specials');
    await _persistSpecialEntry(appid, entry);
}

export async function markSaleActive(appid) {
    await _ensureReady();
    const entry = _mem.specials.get(String(appid));
    if (!entry) return;
    entry.saleEnded  = false;
    entry.verifiedAt = new Date().toISOString();
    _buildSorted('specials');
    await _persistSpecialEntry(appid, entry);
}

// ── Paging ────────────────────────────────────────────────────────────────────

function _getPage(tabId, page) {
    const all   = _sorted[tabId] ?? [];
    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safeP = Math.max(1, Math.min(page, pages));
    const items = all.slice((safeP - 1) * PAGE_SIZE, safeP * PAGE_SIZE).map(e => e.item);
    return { items, total, page: safeP, pages };
}

export async function getAllPaged(page = 1) {
    await _ensureReady();
    return TABS.map(t => ({ id: t.id, label: t.label, ..._getPage(t.id, page) }));
}

export async function getTabPaged(tab, page = 1) {
    await _ensureReady();
    const t = TABS.find(x => x.id === tab);
    if (!t) throw new Error(`Unknown tab: ${tab}`);
    return { id: t.id, label: t.label, ..._getPage(t.id, page) };
}

/**
 * Returns all unique items across all tabs with their stored CDN URLs.
 * Used for startup image pre-warming and the migration tool.
 * @returns {Promise<Array<{ appid: number, headerUrl: string|null, posterUrl: string|null }>>}
 */
export async function getAllItems() {
    await _ensureReady();
    const seen = new Map();
    for (const map of Object.values(_mem)) {
        for (const [appid, entry] of map) {
            if (!seen.has(appid) && entry.item) {
                seen.set(appid, {
                    appid:     Number(appid),
                    headerUrl: entry.item.headerImage ?? null,
                    posterUrl: entry.item.posterImage ?? null,
                });
            }
        }
    }
    return [...seen.values()];
}
