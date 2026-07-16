// Ported verbatim from relay-server src/services/recommend/recommend.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical). games.service is the
// Wave-3 (Batch C1) port; getAll() is the in-memory games cache built at boot.
import { getAll } from '../games/games.service.js';
import { FILTERS } from './filters.js';

const DEPTH_STEPS  = { shallow: 3, normal: 5, deep: 7 };
const MIN_RESULTS  = 3;   // relax last filter if results fall below this
const EARLY_SHOW   = 5;   // skip remaining questions and show results if count ≤ this
const MAX_RESULTS  = 8;

const filterMap = new Map(FILTERS.map(f => [f.id, f]));

/** Library-owned games only — wishlist/discovered titles can't be played yet. */
function ownedGames() {
    return getAll().filter(g => g.source === 'library' || g.source === 'both');
}

/** Weighted random shuffle, returns array of filter ids. */
function pickSequence(n) {
    const pool = [];
    for (const f of FILTERS) {
        const slots = Math.round((f.weight ?? 1) * 10);
        for (let i = 0; i < slots; i++) pool.push(f.id);
    }
    const seen = new Set();
    const seq  = [];
    const shuffled = pool.sort(() => Math.random() - 0.5);
    for (const id of shuffled) {
        if (!seen.has(id)) { seen.add(id); seq.push(id); }
        if (seq.length === n) break;
    }
    // Pad with any remaining filters if pool is smaller than n
    for (const f of FILTERS) {
        if (seq.length >= n) break;
        if (!seen.has(f.id)) { seen.add(f.id); seq.push(f.id); }
    }
    return seq.slice(0, n);
}

/**
 * Apply a list of { type, value } filters to a game set in order.
 * Returns { games, relaxed } where relaxed = true if the last filter was
 * dropped to meet MIN_RESULTS.
 */
function applyFilters(games, filters) {
    let current = games;
    let relaxed = false;

    for (let i = 0; i < filters.length; i++) {
        const { type, value } = filters[i];
        if (value === null) continue;  // skipped question — advance position, don't narrow

        const def = filterMap.get(type);
        if (!def) continue;

        const next = def.apply(current, value);

        if (next.length < MIN_RESULTS && i === filters.length - 1) {
            // Last filter reduced results below threshold — drop it
            relaxed = true;
            break;
        }

        current = next;
    }

    return { games: current, relaxed };
}

/**
 * Core recommendation step.
 *
 * First call  → sequence is undefined, depth determines how many questions.
 * Later calls → sequence is echoed back by the client.
 *
 * Returns either:
 *   { done: false, sequence, question: { type, label, options } }
 *   { done: true,  sequence, games, relaxed }
 *
 * @param {{ depth?: string, sequence?: string, filters?: any[] }} input
 */
export function getRecommendation({ depth = 'normal', sequence, filters = [] }) {
    const n   = DEPTH_STEPS[depth] ?? 5;
    const seq = sequence ?? pickSequence(n);

    const base = ownedGames();
    const { games: filtered, relaxed } = applyFilters(base, filters);

    // How far through the sequence are we?
    const step = filters.length;

    // Find the next usable filter in the sequence
    let nextId      = null;
    let nextDef     = null;
    let nextOptions = [];

    for (let i = step; i < seq.length; i++) {
        const def = filterMap.get(seq[i]);
        if (!def) continue;

        const opts = def.getOptions(filtered).filter(o => o.count > 0);
        if (opts.length >= 2) {
            nextId      = seq[i];
            nextDef     = def;
            nextOptions = opts;
            break;
        }
        // Skip filters that yield fewer than 2 valid options for the current set
    }

    if (!nextId || filtered.length <= EARLY_SHOW) {
        return {
            done:     true,
            sequence: seq,
            games:    filtered
                .sort(() => Math.random() - 0.5)
                .slice(0, MAX_RESULTS)
                .map(g => ({
                    appid:           g.appid,
                    name:            g.name,
                    playtimeMinutes: g.playtimeMinutes,
                    header:          g.media?.header ?? null,
                })),
            relaxed,
        };
    }

    return {
        done:     false,
        sequence: seq,
        question: {
            type:    nextId,
            label:   nextDef.label,
            options: nextOptions,
        },
    };
}
