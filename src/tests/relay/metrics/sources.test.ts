// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/sources.test.js (node:test → vitest).
// Contract tests for the source registry — behavior must match the relay exactly
// (docs/relay-fold-in.md §6: parity is the correctness definition during
// migration, so assertions are carried over unmodified).
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    SOURCES,
    TOP_LEVEL_SOURCES,
    attribute,
    getSource,
    isKnownSource,
    topLevelOf,
    otherId,
} from '../../../lib/server/relay/metrics/sources.js';

// ── Registry integrity ────────────────────────────────────────────────────────

describe('SOURCES registry', () => {
    test('every id is unique', () => {
        const ids = SOURCES.map(s => s.id);
        assert.equal(new Set(ids).size, ids.length);
    });

    test('every id agrees with its top-level source', () => {
        for (const s of SOURCES) assert.equal(topLevelOf(s.id), s.source, `${s.id} vs ${s.source}`);
    });

    test('every source declares at least one prefix and a valid kind', () => {
        for (const s of SOURCES) {
            assert.ok(s.prefixes.length > 0, `${s.id} has no prefixes`);
            assert.ok(['scheduled', 'on-demand'].includes(s.kind), `${s.id} kind=${s.kind}`);
        }
    });

    test('every prefix starts with its own top-level source directory', () => {
        for (const s of SOURCES) {
            for (const p of s.prefixes) {
                assert.equal(p.split('/')[0], s.source, `${s.id} prefix ${p}`);
            }
        }
    });

    test('no prefix is claimed by two different sources', () => {
        const seen = new Map();
        for (const s of SOURCES) {
            for (const p of s.prefixes) {
                assert.equal(seen.has(p), false, `prefix ${p} claimed by ${seen.get(p)} and ${s.id}`);
                seen.set(p, s.id);
            }
        }
    });

    test('steam is split into subsystems rather than one row', () => {
        const steam = SOURCES.filter(s => s.source === 'steam');
        assert.ok(steam.length > 5);
        assert.ok(steam.every(s => s.id.includes(':')));
    });

    test('TOP_LEVEL_SOURCES is deduplicated', () => {
        assert.equal(new Set(TOP_LEVEL_SOURCES).size, TOP_LEVEL_SOURCES.length);
        assert.ok(TOP_LEVEL_SOURCES.includes('steam'));
    });
});

// ── Lookup ────────────────────────────────────────────────────────────────────

describe('getSource / isKnownSource', () => {
    test('resolves a known id', () => {
        assert.equal(getSource('steam:images').label, 'Steam Images');
        assert.equal(isKnownSource('steam:images'), true);
    });

    test('rejects an unknown id', () => {
        assert.equal(getSource('steam'), null);
        assert.equal(isKnownSource('steam'), false);
        assert.equal(isKnownSource('nope'), false);
    });
});

// ── Attribution ───────────────────────────────────────────────────────────────

describe('attribute', () => {
    test('maps files into their declared source', () => {
        assert.equal(attribute('steam/images/440/header.jpg'), 'steam:images');
        assert.equal(attribute('steam/videos/440/0.mp4'),      'steam:videos');
        assert.equal(attribute('steam/movies/440.json'),       'steam:videos');
        assert.equal(attribute('hltb/index.json'),             'hltb');
        assert.equal(attribute('reddit/comments/1.json'),      'reddit');
    });

    test('longest prefix wins so sibling dirs and files do not collide', () => {
        // 'steam/community-reviews' must not be swallowed by 'steam/reviews.json'
        assert.equal(attribute('steam/community-reviews/440.json'), 'steam:community-reviews');
        assert.equal(attribute('steam/reviews.json'),               'steam:reviews');
        // 'steam/news-index.json' and 'steam/news/440.json' share one subsystem
        assert.equal(attribute('steam/news/440.json'),   'steam:news');
        assert.equal(attribute('steam/news-index.json'), 'steam:news');
        // player-counts exists as both a file and a directory
        assert.equal(attribute('steam/player-counts.json'),          'steam:player-counts');
        assert.equal(attribute('steam/player-counts/filtered.json'), 'steam:player-counts');
    });

    test('claims ManagedFile sidecars alongside the file they belong to', () => {
        assert.equal(attribute('steam/games.json'),                    'steam:library');
        assert.equal(attribute('steam/games.json.checkpoint.json'),    'steam:library');
        assert.equal(attribute('steam/games.json.tmp'),                'steam:library');
        assert.equal(attribute('steam/play-log.json.checkpoint.json'), 'steam:sessions');
    });

    test('claims the weekly featured buckets by prefix', () => {
        assert.equal(attribute('steam/featured-2026-07-06.json'), 'steam:featured');
        assert.equal(attribute('steam/featured-2026-05-18.json'), 'steam:featured');
    });

    test('unclaimed files fall into the <source>:other bucket', () => {
        assert.equal(attribute('steam/mystery-file.json'), 'steam:other');
        assert.equal(attribute('steam/achievements.json.migrated'), 'steam:achievements');
        assert.equal(attribute('steam/featured-history.json.migrated'), 'steam:featured');
    });

    test('claims every top-level entry observed on the live NAS', () => {
        // Snapshot of $DATA_DIR/relay taken 2026-07-09.  If a sync service starts
        // writing somewhere new, this fails and the registry gets a new prefix
        // instead of the bytes silently piling up in an :other bucket.
        const observed = [
            'steam/account.json', 'steam/achievements/440.json', 'steam/achievements.json',
            'steam/adult-appids.json', 'steam/applist.json', 'steam/community-reviews/440.json',
            'steam/featured-2026-07-06.json', 'steam/friends.json', 'steam/games.json',
            'steam/images/440/header.jpg', 'steam/library-firstseen.json', 'steam/movies/440.json',
            'steam/news/440.json', 'steam/news-index.json', 'steam/play-log.json',
            'steam/player-counts/filtered.json', 'steam/player-counts.json', 'steam/player-stats.json',
            'steam/playtime-snapshots.json', 'steam/poster-index.json', 'steam/recently-played.json',
            'steam/reviews.json', 'steam/sessions/1.json', 'steam/sessions.json',
            'steam/store/440.json', 'steam/videos/440/0.mp4', 'steam/wishlist.json',
            'guides/440/ign/1/content.json', 'hltb/index.json', 'igdb/440.json', 'itad/440.json',
            'mail/messages/1.json', 'pcgw/440.json', 'progress-suggest/tracker-timings.json',
            'protondb/440.json', 'reddit/440.json', 'sms/threads/1.json',
        ];
        const unclaimed = observed.filter(p => attribute(p).endsWith(':other'));
        assert.deepEqual(unclaimed, []);
    });

    test('otherId derives from the top-level source', () => {
        assert.equal(otherId('steam'), 'steam:other');
    });
});
