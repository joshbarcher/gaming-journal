/**
 * Registry of every data source the relay server pulls from.
 *
 * A source id is `<source>` or `<source>:<subsystem>`.  The steam source is
 * split into subsystems because a single "steam" row would blend six sync
 * functions on three different schedules writing half a terabyte across a
 * dozen directories — a stale `steam:images` tells you nothing about whether
 * `steam:library` is still updating.
 *
 * `prefixes` are paths relative to $DATA_DIR/relay.  The disk scanner walks
 * each top-level directory once and attributes every file it finds to the
 * source with the LONGEST matching prefix.  Files matching nothing are
 * attributed to `<source>:other`, so the per-source totals always add up to
 * what is actually on the NAS rather than silently dropping bytes.
 *
 * Prefix matching is plain string matching, not globbing.  That is why
 * `steam/featured-` catches the weekly `featured-2026-07-06.json` buckets and
 * `steam/games.json` catches its own `.checkpoint.json` sibling.
 *
 * `kind`:
 *   'scheduled' — driven by a timer; a stale timestamp means something broke.
 *   'on-demand' — only runs when a user asks; a stale timestamp means nothing.
 *                 The dashboard must not raise a staleness warning on these.
 */

const MIN  = 60_000;
const HOUR = 60 * MIN;
const DAY  = 24 * HOUR;

/**
 * `kind` is what the dashboard's staleness logic keys off, so it must describe
 * what actually runs rather than what conceptually could.  A source is only
 * 'scheduled' if a timer calls a tracked() entrypoint for it — everything else,
 * including subsystems that write on demand (steam:images fires only when the
 * achievement sync finds new games) or from a CLI tool (steam:videos), is
 * 'on-demand' and never raises a staleness warning.
 *
 * `intervalMs` is the cadence of that timer.  A scheduled source is considered
 * stale once it has gone STALE_FACTOR intervals without a successful run.
 *
 * `syncable` means the source has a manual trigger in actions.js.  It is
 * declared here rather than read from that module so the read-only dashboard
 * request path never imports the sync services (and, through pcgw, Puppeteer).
 * A test asserts the two never drift apart.
 *
 * `cadence` decides whether a source belongs on the new-records chart:
 *
 *   'entity'   — pulls discrete things (games, posts, messages).  "How many are
 *                new?" is a meaningful question, so it is charted.
 *   'sampling' — a time series.  Every observation is new by construction, so a
 *                "new records" count is technically enormous and practically
 *                meaningless: player-counts writes ~2,400 samples a day, which
 *                would be 93% of every bar.  The only real question for these is
 *                "did it sample on schedule", which the Activity column answers.
 *                Sampling sources are excluded from the chart, never from the table.
 *
 * `novelty` means the source reports `created` / `updated` counts.  Sources
 * without it show '—' rather than a fabricated 0, which would read as "ran but
 * found nothing" when the truth is "we never measured".
 */
export const SOURCES = [
    // ── Steam (split by subsystem) ────────────────────────────────────────────
    // The 30-minute snapshot tick drives library / sessions / player-counts /
    // reviews / achievements.
    { id: 'steam:library',           source: 'steam',    label: 'Steam Library',       kind: 'scheduled', intervalMs: 30 * MIN, syncable: true, cadence: 'entity',   novelty: true,  prefixes: ['steam/games.json', 'steam/wishlist.json', 'steam/recently-played.json', 'steam/applist.json', 'steam/library-firstseen.json', 'steam/adult-appids.json'] },
    { id: 'steam:achievements',      source: 'steam',    label: 'Steam Achievements',  kind: 'scheduled', intervalMs: 30 * MIN, syncable: true, cadence: 'entity',   novelty: true,  prefixes: ['steam/achievements'] },
    { id: 'steam:reviews',           source: 'steam',    label: 'Steam Reviews',       kind: 'scheduled', intervalMs: 30 * MIN, syncable: true, cadence: 'entity',   novelty: true,  prefixes: ['steam/reviews.json'] },
    // Sampling: one playtime snapshot per tick. Never charted as "new records".
    { id: 'steam:sessions',          source: 'steam',    label: 'Steam Sessions',      kind: 'scheduled', intervalMs: 30 * MIN, syncable: true, cadence: 'sampling', prefixes: ['steam/sessions', 'steam/playtime-snapshots.json', 'steam/play-log.json'] },
    // Sampling: ~2,400 player-count observations a day, all new by construction.
    { id: 'steam:player-counts',     source: 'steam',    label: 'Steam Player Counts', kind: 'scheduled', intervalMs: 30 * MIN, syncable: true, cadence: 'sampling', prefixes: ['steam/player-counts'] },
    { id: 'steam:featured',          source: 'steam',    label: 'Steam Featured',      kind: 'scheduled', intervalMs: 60 * MIN, syncable: true, cadence: 'entity',   novelty: true,  prefixes: ['steam/featured-', 'steam/poster-index.json'] },
    // Fires only when the achievement sync turns up new games — not on a timer.
    { id: 'steam:images',            source: 'steam',    label: 'Steam Images',        kind: 'on-demand', syncable: true, cadence: 'entity', novelty: true, prefixes: ['steam/images'] },
    { id: 'steam:community-reviews', source: 'steam',    label: 'Community Reviews',   kind: 'on-demand', syncable: true, cadence: 'entity', novelty: true, prefixes: ['steam/community-reviews'] },
    { id: 'steam:stats',             source: 'steam',    label: 'Steam Player Stats',  kind: 'on-demand', cadence: 'entity', prefixes: ['steam/player-stats.json'] },
    // Needs an appid; no whole-source trigger.
    { id: 'steam:news',              source: 'steam',    label: 'Steam News',          kind: 'on-demand', cadence: 'entity', prefixes: ['steam/news'] },
    // Downloaded by a CLI tool.
    { id: 'steam:videos',            source: 'steam',    label: 'Steam Videos',        kind: 'on-demand', cadence: 'entity', prefixes: ['steam/videos', 'steam/movies'] },
    // Written by the event-driven discovery worker, not a timer.
    { id: 'steam:store',             source: 'steam',    label: 'Steam Store',         kind: 'on-demand', cadence: 'entity', prefixes: ['steam/store'] },
    // Refreshed via cache-manager rebuild + its own TTL; no tracked entrypoint.
    { id: 'steam:account',           source: 'steam',    label: 'Steam Account',       kind: 'on-demand', cadence: 'entity', prefixes: ['steam/account.json', 'steam/friends.json'] },

    // ── Standalone sources ────────────────────────────────────────────────────
    { id: 'hltb',                    source: 'hltb',     label: 'HowLongToBeat',       kind: 'scheduled', intervalMs: 30 * MIN,  syncable: true, cadence: 'entity', novelty: true, prefixes: ['hltb'] },
    { id: 'itad',                    source: 'itad',     label: 'IsThereAnyDeal',      kind: 'scheduled', intervalMs: 72 * HOUR, syncable: true, cadence: 'entity', novelty: true, prefixes: ['itad'] },
    { id: 'protondb',                source: 'protondb', label: 'ProtonDB',            kind: 'scheduled', intervalMs: 7 * DAY,   syncable: true, cadence: 'entity', novelty: true, prefixes: ['protondb'] },
    { id: 'reddit',                  source: 'reddit',   label: 'Reddit',              kind: 'scheduled', intervalMs: 24 * HOUR, syncable: true, cadence: 'entity', novelty: true, prefixes: ['reddit'] },
    { id: 'mail',                    source: 'mail',     label: 'Gmail',               kind: 'scheduled', intervalMs: 30 * MIN,  syncable: true, cadence: 'entity', novelty: true, prefixes: ['mail'] },
    // No novelty: a PCGW entry is a bag of parsed wiki sections with no stable
    // identity or version, so "did it change" means diffing free-form scraped
    // HTML — the diff would fire on any cosmetic wiki edit. It reports what it
    // pulled and shows '—' for new records rather than guessing.
    { id: 'pcgw',                    source: 'pcgw',     label: 'PCGamingWiki',        kind: 'on-demand', syncable: true, cadence: 'entity', prefixes: ['pcgw'] },
    { id: 'igdb',                    source: 'igdb',     label: 'IGDB',                kind: 'on-demand', cadence: 'entity', prefixes: ['igdb'] },
    { id: 'sms',                     source: 'sms',      label: 'SMS',                 kind: 'on-demand', cadence: 'entity', prefixes: ['sms'] },
    { id: 'guides',                  source: 'guides',   label: 'Guides',              kind: 'on-demand', cadence: 'entity', prefixes: ['guides'] },
    { id: 'progress-suggest',        source: 'progress-suggest', label: 'Progress Suggest', kind: 'on-demand', cadence: 'entity', prefixes: ['progress-suggest'] },
    // The dashboard's own storage. Tracked for disk usage only.
    { id: 'metrics',                 source: 'metrics',  label: 'Metrics',             kind: 'on-demand', cadence: 'entity', prefixes: ['metrics'] },
];

/** True when the source's new-record counts belong on the chart. */
export function isCharted(id) {
    const source = BY_ID.get(id);
    return Boolean(source && source.cadence !== 'sampling' && source.novelty);
}

/** A scheduled source is stale after this many missed intervals. */
export const STALE_FACTOR = 3;

/**
 * Stacked-bar series order for the dashboard chart.
 *
 * Colour follows the entity, never its rank — each source's hue is frozen, so a
 * quiet day for `mail` never repaints `hltb`.  Only top-level sources that are
 * charted appear; anything else folds into "Other" rather than generating a
 * ninth hue.
 *
 * HUE CHOICE lives in dashboard.css: six hues spaced 60° apart in OKLCH, at a
 * fixed lightness per surface.  Even spacing is what makes them look different —
 * the earlier hand-picked set put red, orange and magenta on the same arc and
 * scored a worst pair of ΔE 25; this one scores 57.  Fixed lightness is what
 * makes them read on a dark background: every hue clears 4.9:1.
 *
 * ORDER no longer carries the distinguishability burden, because *every* pair is
 * far apart rather than only the touching ones.  The chart still ships 2px
 * surface gaps between segments, an always-present legend, and a table view.
 */
export const CHART_SERIES = ['steam', 'itad', 'mail', 'reddit', 'hltb', 'protondb'];

/** Top-level sources that are charted; everything else sums into 'other'. */
export function chartSeriesOf(source) {
    return CHART_SERIES.includes(source) ? source : 'other';
}

/** Top-level directories under $DATA_DIR/relay that the disk scanner walks. */
export const TOP_LEVEL_SOURCES = [...new Set(SOURCES.map(s => s.source))];

const BY_ID = new Map(SOURCES.map(s => [s.id, s]));

/** Prefixes sorted longest-first so `steam/news-index.json` beats `steam/news`. */
const PREFIX_INDEX = SOURCES
    .flatMap(s => s.prefixes.map(p => ({ prefix: p, id: s.id })))
    .sort((a, b) => b.prefix.length - a.prefix.length);

/** The catch-all id for files under a top-level dir that match no prefix. */
export function otherId(source) {
    return `${source}:other`;
}

export function getSource(id) {
    return BY_ID.get(id) ?? null;
}

export function isKnownSource(id) {
    return BY_ID.has(id);
}

/** The top-level source for an id: 'steam:images' → 'steam', 'hltb' → 'hltb'. */
export function topLevelOf(id) {
    return id.split(':')[0];
}

/**
 * Attribute a relay-relative path (POSIX separators) to a source id.
 * Falls back to `<source>:other` so no bytes go unaccounted for.
 */
export function attribute(relPath) {
    for (const { prefix, id } of PREFIX_INDEX) {
        if (relPath === prefix || relPath.startsWith(prefix)) return id;
    }
    // Split on '/', not ':' — this is a file path, not a source id.
    return otherId(relPath.split('/')[0]);
}
