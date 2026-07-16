// Ported verbatim from relay-server src/services/recommend/filters.js
// (docs/relay-fold-in.md §6 — no imports, byte-identical logic).
/**
 * Filter registry for the recommendation engine.
 *
 * Each entry describes one question the engine can ask.  The engine picks a
 * random subset of these (determined by the depth setting) and sequences them.
 *
 * To add a new filter: append one object to FILTERS.  No other wiring needed.
 */

function parseYear(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.match(/\b(\d{4})\b/);
    return m ? parseInt(m[1], 10) : null;
}

function topN(countMap, n) {
    return [...countMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}

export const FILTERS = [
    // ── Genre ─────────────────────────────────────────────────────────────────
    {
        id:     'genre',
        label:  'What genre?',
        weight: 1,

        getOptions(games) {
            const counts = new Map();
            for (const g of games) {
                for (const genre of g.store?.genres ?? []) {
                    counts.set(genre, (counts.get(genre) ?? 0) + 1);
                }
            }
            return topN(counts, 5).map(([genre, count]) => ({
                value: genre,
                label: genre,
                count,
            }));
        },

        apply(games, value) {
            return games.filter(g => g.store?.genres?.includes(value));
        },
    },

    // ── Game length ───────────────────────────────────────────────────────────
    // gameplayMain is stored in hours (comp_main / 3600 in hltb.service.js)
    {
        id:     'length',
        label:  'How long a game?',
        weight: 1,

        getOptions(games) {
            const buckets = [
                { value: 'short',  label: 'Short  (< 5 h)',    min: 0,  max: 5   },
                { value: 'medium', label: 'Medium (5 – 20 h)', min: 5,  max: 20  },
                { value: 'long',   label: 'Long   (20 – 50 h)', min: 20, max: 50  },
                { value: 'epic',   label: 'Epic   (50 h +)',    min: 50, max: Infinity },
            ];
            return buckets.map(b => ({
                value: b.value,
                label: b.label,
                count: games.filter(g => {
                    const hrs = g.hltb?.gameplayMain ?? null;
                    if (hrs === null) return false;
                    return hrs >= b.min && hrs < b.max;
                }).length,
            }));
        },

        apply(games, value) {
            const ranges = {
                short:  [0,  5],
                medium: [5,  20],
                long:   [20, 50],
                epic:   [50, Infinity],
            };
            const [min, max] = ranges[value] ?? [0, Infinity];
            return games.filter(g => {
                const hrs = g.hltb?.gameplayMain ?? null;
                if (hrs === null) return false;
                return hrs >= min && hrs < max;
            });
        },
    },

    // ── Tags (vibe) ───────────────────────────────────────────────────────────
    {
        id:     'tags',
        label:  'Pick a vibe',
        weight: 1,

        getOptions(games) {
            const counts = new Map();
            for (const g of games) {
                for (const tag of g.store?.tags ?? []) {
                    counts.set(tag, (counts.get(tag) ?? 0) + 1);
                }
            }
            // Pick 5 randomly from the top-20 so options vary each session
            const pool = topN(counts, 20);
            const sample = pool.sort(() => Math.random() - 0.5).slice(0, 5);
            return sample.map(([tag, count]) => ({ value: tag, label: tag, count }));
        },

        apply(games, value) {
            return games.filter(g => g.store?.tags?.includes(value));
        },
    },

    // ── Release era ───────────────────────────────────────────────────────────
    {
        id:     'era',
        label:  'Old or new?',
        weight: 1,

        getOptions(games) {
            const buckets = [
                { value: 'classic', label: 'Classic (before 2010)', before: 2010 },
                { value: 'modern',  label: 'Modern  (2010 – 2018)', from: 2010, before: 2019 },
                { value: 'recent',  label: 'Recent  (2019 +)',      from: 2019 },
            ];
            return buckets.map(b => ({
                value: b.value,
                label: b.label,
                count: games.filter(g => {
                    const yr = parseYear(g.store?.releaseDate);
                    if (!yr) return false;
                    if (b.before && yr >= b.before) return false;
                    if (b.from   && yr <  b.from)   return false;
                    return true;
                }).length,
            }));
        },

        apply(games, value) {
            return games.filter(g => {
                const yr = parseYear(g.store?.releaseDate);
                if (!yr) return false;
                if (value === 'classic') return yr < 2010;
                if (value === 'modern')  return yr >= 2010 && yr < 2019;
                if (value === 'recent')  return yr >= 2019;
                return false;
            });
        },
    },

    // ── Community popularity ──────────────────────────────────────────────────
    {
        id:     'popularity',
        label:  'Niche or popular?',
        weight: 1,

        getOptions(games) {
            const buckets = [
                { value: 'niche',       label: 'Niche       (< 500 reviews)',   max: 500 },
                { value: 'popular',     label: 'Popular     (500 – 10 k)',      min: 500,   max: 10000 },
                { value: 'blockbuster', label: 'Blockbuster (10 k + reviews)',  min: 10000 },
            ];
            return buckets.map(b => ({
                value: b.value,
                label: b.label,
                count: games.filter(g => {
                    const r = g.store?.recommendations ?? null;
                    if (r === null) return false;
                    if (b.min  !== undefined && r < b.min)  return false;
                    if (b.max  !== undefined && r >= b.max) return false;
                    return true;
                }).length,
            }));
        },

        apply(games, value) {
            return games.filter(g => {
                const r = g.store?.recommendations ?? null;
                if (r === null) return false;
                if (value === 'niche')       return r < 500;
                if (value === 'popular')     return r >= 500   && r < 10000;
                if (value === 'blockbuster') return r >= 10000;
                return false;
            });
        },
    },

    // ── Play status ───────────────────────────────────────────────────────────
    {
        id:     'status',
        label:  'Played before?',
        weight: 1,

        getOptions(games) {
            return [
                {
                    value: 'unplayed',
                    label: 'Never touched it',
                    count: games.filter(g => g.playtimeMinutes === 0).length,
                },
                {
                    value: 'tried',
                    label: 'Tried it (< 2 h)',
                    count: games.filter(g => g.playtimeMinutes > 0 && g.playtimeMinutes <= 120).length,
                },
                {
                    value: 'played',
                    label: 'Played it (2 h +)',
                    count: games.filter(g => g.playtimeMinutes > 120).length,
                },
            ];
        },

        apply(games, value) {
            if (value === 'unplayed') return games.filter(g => g.playtimeMinutes === 0);
            if (value === 'tried')    return games.filter(g => g.playtimeMinutes > 0 && g.playtimeMinutes <= 120);
            if (value === 'played')   return games.filter(g => g.playtimeMinutes > 120);
            return games;
        },
    },

    // ── Metacritic score ──────────────────────────────────────────────────────
    {
        id:     'metacritic',
        label:  'What do the critics say?',
        weight: 0.7,

        getOptions(games) {
            const buckets = [
                { value: 'average',   label: 'Average   (60 – 74)',  min: 60, max: 75 },
                { value: 'good',      label: 'Good      (75 – 89)',  min: 75, max: 90 },
                { value: 'acclaimed', label: 'Acclaimed (90 +)',     min: 90 },
            ];
            return buckets.map(b => ({
                value: b.value,
                label: b.label,
                count: games.filter(g => {
                    const score = g.store?.metacritic?.score ?? null;
                    if (score === null) return false;
                    if (b.min !== undefined && score < b.min)  return false;
                    if (b.max !== undefined && score >= b.max) return false;
                    return true;
                }).length,
            }));
        },

        apply(games, value) {
            return games.filter(g => {
                const score = g.store?.metacritic?.score ?? null;
                if (score === null) return false;
                if (value === 'average')   return score >= 60 && score < 75;
                if (value === 'good')      return score >= 75 && score < 90;
                if (value === 'acclaimed') return score >= 90;
                return false;
            });
        },
    },
];
