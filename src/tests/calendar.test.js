import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localDateStr as _localDateStr } from '../lib/js/utils.js';
import {
    buildDayMap as _buildDayMap,
    splitAtMidnight as _splitAtMidnight,
    localMidnight,
    buildReleaseMap,
    buildCell,
    buildMonth,
} from '../lib/js/views/calendar-render.js';

// ── _localDateStr ─────────────────────────────────────────────────────────────

describe('_localDateStr', () => {
    it('converts a UTC ISO string to a local YYYY-MM-DD string', () => {
        // Use a fixed noon-UTC time so the local date is unambiguous in any timezone.
        const iso = '2026-05-17T12:00:00.000Z';
        const result = _localDateStr(iso);
        assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
        // The date part must be May 17 for noon-UTC regardless of local TZ offset.
        const d = new Date(iso);
        const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        assert.equal(result, expected);
    });

    it('accepts a Date object', () => {
        const d = new Date('2026-05-17T12:00:00.000Z');
        const result = _localDateStr(d);
        assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    });
});

// ── _buildDayMap — basic ──────────────────────────────────────────────────────

describe('_buildDayMap — basic', () => {
    it('returns an empty map for empty sessions', () => {
        const map = _buildDayMap({});
        assert.equal(map.size, 0);
    });

    it('maps a single session to its start date', () => {
        const sessions = {
            570: {
                name: 'Dota 2',
                sessions: [{ startedAt: '2026-05-17T12:00:00.000Z', endedAt: '2026-05-17T13:00:00.000Z', durationMin: 60 }],
            },
        };
        const map = _buildDayMap(sessions);
        const d = new Date('2026-05-17T12:00:00.000Z');
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        assert.ok(map.has(key), `expected key "${key}" in dayMap`);
        assert.equal(map.get(key)[0].durationMin, 60);
    });

    it('sums two sessions for the same game on the same day', () => {
        const sessions = {
            570: {
                name: 'Dota 2',
                sessions: [
                    { startedAt: '2026-05-17T10:00:00.000Z', durationMin: 45 },
                    { startedAt: '2026-05-17T14:00:00.000Z', durationMin: 30 },
                ],
            },
        };
        const map = _buildDayMap(sessions);
        const d = new Date('2026-05-17T10:00:00.000Z');
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const entry = map.get(key).find(e => e.appid === 570);
        assert.equal(entry.durationMin, 75);
    });

    it('filters out flagged software', () => {
        const sessions = {
            12345: { name: 'SteamVR', sessions: [{ startedAt: '2026-05-17T12:00:00.000Z', durationMin: 10 }] },
            570:   { name: 'Dota 2',  sessions: [{ startedAt: '2026-05-17T12:00:00.000Z', durationMin: 60 }] },
        };
        const flags = { 12345: { software: true } };
        const map = _buildDayMap(sessions, flags);

        for (const entries of map.values()) {
            for (const e of entries) {
                assert.notEqual(e.appid, 12345, 'flagged software should be excluded');
            }
        }
        // Dota 2 should still be present
        const hasDota = [...map.values()].flat().some(e => e.appid === 570);
        assert.ok(hasDota);
    });
});

// ── _splitAtMidnight ──────────────────────────────────────────────────────────

describe('_splitAtMidnight', () => {
    it('returns the session unchanged when start and end are on the same local day', () => {
        const session = {
            startedAt:   '2026-05-17T20:00:00.000Z',
            endedAt:     '2026-05-17T22:00:00.000Z',
            durationMin: 120,
        };
        const parts = _splitAtMidnight(session);
        assert.equal(parts.length, 1);
        assert.equal(parts[0].durationMin, 120);
    });

    it('returns the session unchanged when endedAt is absent', () => {
        const session = { startedAt: '2026-05-17T22:00:00.000Z', durationMin: 30 };
        const parts = _splitAtMidnight(session);
        assert.equal(parts.length, 1);
    });

    it('splits a cross-midnight session into two parts that sum to the total', () => {
        // Use a local noon-based reference to construct a known midnight crossing:
        // build start/end relative to a concrete local midnight.
        const midnightMs = new Date(2026, 4, 18, 0, 0, 0, 0).getTime(); // May 18 local midnight
        const startMs    = midnightMs - 60 * 60_000;  // 1h before midnight (11pm May 17)
        const endMs      = midnightMs + 2 * 60 * 60_000; // 2h after midnight (2am May 18)

        const session = {
            startedAt:   new Date(startMs).toISOString(),
            endedAt:     new Date(endMs).toISOString(),
            durationMin: 180,
        };
        const parts = _splitAtMidnight(session);
        assert.equal(parts.length, 2, 'should produce two parts');

        const totalMin = parts.reduce((s, p) => s + p.durationMin, 0);
        assert.ok(Math.abs(totalMin - 180) <= 1, `parts should sum to ~180, got ${totalMin}`);

        // First part ends at midnight
        assert.equal(_localDateStr(parts[0].startedAt), _localDateStr(new Date(startMs)));
        assert.equal(_localDateStr(parts[0].endedAt),   _localDateStr(new Date(midnightMs)));

        // Second part starts at midnight
        assert.equal(_localDateStr(parts[1].startedAt), _localDateStr(new Date(midnightMs)));
        assert.equal(_localDateStr(parts[1].endedAt),   _localDateStr(new Date(endMs)));
    });
});

// ── _buildDayMap — cross-midnight sessions ────────────────────────────────────

describe('_buildDayMap — cross-midnight', () => {
    it('splits a cross-midnight session so each day shows only its own time', () => {
        const midnightMs = new Date(2026, 4, 18, 0, 0, 0, 0).getTime();
        const startMs    = midnightMs - 60 * 60_000;   // 11pm May 17 local
        const endMs      = midnightMs + 2 * 60 * 60_000; // 2am May 18 local

        const sessions = {
            400: {
                name: 'Portal 2',
                sessions: [{
                    startedAt:   new Date(startMs).toISOString(),
                    endedAt:     new Date(endMs).toISOString(),
                    durationMin: 180,
                }],
            },
        };
        const map = _buildDayMap(sessions);

        const day17 = _localDateStr(new Date(startMs));
        const day18 = _localDateStr(new Date(endMs));

        // Must be two different days for this test to be meaningful
        assert.notEqual(day17, day18, 'test requires crossing a day boundary');

        const e17 = (map.get(day17) ?? []).find(e => e.appid === 400);
        const e18 = (map.get(day18) ?? []).find(e => e.appid === 400);

        assert.ok(e17, 'May 17 should have an entry');
        assert.ok(e18, 'May 18 should have an entry');

        // ~60 min on the 17th, ~120 min on the 18th (allow ±1 for rounding)
        assert.ok(Math.abs(e17.durationMin - 60)  <= 1, `May 17 expected ~60 min, got ${e17.durationMin}`);
        assert.ok(Math.abs(e18.durationMin - 120) <= 1, `May 18 expected ~120 min, got ${e18.durationMin}`);
    });

    it('handles two separate same-game sessions on different days without cross-contamination', () => {
        const sessions = {
            400: {
                name: 'Portal 2',
                sessions: [
                    { startedAt: '2026-05-17T20:00:00.000Z', endedAt: '2026-05-17T21:00:00.000Z', durationMin: 60 },
                    { startedAt: '2026-05-18T12:00:00.000Z', endedAt: '2026-05-18T13:30:00.000Z', durationMin: 90 },
                ],
            },
        };
        const map = _buildDayMap(sessions);

        const day17 = _localDateStr('2026-05-17T20:00:00.000Z');
        const day18 = _localDateStr('2026-05-18T12:00:00.000Z');

        const e17 = (map.get(day17) ?? []).find(e => e.appid === 400);
        const e18 = (map.get(day18) ?? []).find(e => e.appid === 400);

        assert.ok(e17, 'session on the 17th should exist');
        assert.ok(e18, 'session on the 18th should exist');
        assert.equal(e17.durationMin, 60, '17th should have only its own 60 min');
        assert.equal(e18.durationMin, 90, '18th should have only its own 90 min');
    });
});

// ── localMidnight ─────────────────────────────────────────────────────────────

describe('localMidnight', () => {
    it('returns the Unix ms timestamp of midnight local time for a date string', () => {
        const ts = localMidnight('2026-05-17');
        const d  = new Date(ts);
        assert.equal(d.getFullYear(), 2026);
        assert.equal(d.getMonth(),    4);      // May is 0-indexed 4
        assert.equal(d.getDate(),     17);
        assert.equal(d.getHours(),    0);
        assert.equal(d.getMinutes(),  0);
        assert.equal(d.getSeconds(),  0);
    });

    it('returns different timestamps for different dates', () => {
        assert.notEqual(localMidnight('2026-05-17'), localMidnight('2026-05-18'));
    });
});

// ── buildReleaseMap ───────────────────────────────────────────────────────────

describe('buildReleaseMap', () => {
    it('returns an empty map for empty input', () => {
        assert.equal(buildReleaseMap([]).size, 0);
    });

    it('groups games by releaseDateIso', () => {
        const map = buildReleaseMap([
            { releaseDateIso: '2026-05-17', appid: 570, name: 'Dota 2' },
            { releaseDateIso: '2026-05-17', appid: 440, name: 'TF2' },
            { releaseDateIso: '2026-05-18', appid: 400, name: 'Portal 2' },
        ]);
        assert.equal(map.size, 2);
        assert.equal(map.get('2026-05-17').length, 2);
        assert.equal(map.get('2026-05-18').length, 1);
        assert.deepEqual(map.get('2026-05-18')[0], { appid: 400, name: 'Portal 2' });
    });

    it('skips entries without a releaseDateIso', () => {
        const map = buildReleaseMap([
            { appid: 570, name: 'Dota 2' },
            { releaseDateIso: '2026-05-17', appid: 440, name: 'TF2' },
        ]);
        assert.equal(map.size, 1);
    });
});

// ── buildCell ─────────────────────────────────────────────────────────────────

describe('buildCell', () => {
    it('renders a basic empty cell with the day number', () => {
        const html = buildCell(2026, 4, 17, false, [], []);
        assert.ok(html.includes('cal-cell'));
        assert.ok(html.includes('17'));
        assert.ok(!html.includes('cal-cell--today'));
        assert.ok(!html.includes('cal-cell--played'));
        assert.ok(!html.includes('cal-cell--release-day'));
    });

    it('adds today class when isToday is true', () => {
        const html = buildCell(2026, 4, 17, true, [], []);
        assert.ok(html.includes('cal-cell--today'));
    });

    it('adds played class and entry link when entries are present', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 570, name: 'Dota 2', durationMin: 60 }], []);
        assert.ok(html.includes('cal-cell--played'));
        assert.ok(html.includes('Dota 2'));
        assert.ok(html.includes('/game/570'));
    });

    it('adds release-day class when releases are present', () => {
        const html = buildCell(2026, 4, 17, false, [], [{ appid: 440, name: 'TF2' }]);
        assert.ok(html.includes('cal-cell--release-day'));
        assert.ok(html.includes('TF2'));
    });

    it('formats duration: minutes only', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 1, name: 'X', durationMin: 45 }], []);
        assert.ok(html.includes('45m'));
    });

    it('formats duration: hours only (no minutes)', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 1, name: 'X', durationMin: 120 }], []);
        assert.ok(html.includes('2h'));
        assert.ok(!html.includes('2h 0m'));
    });

    it('formats duration: hours and minutes', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 1, name: 'X', durationMin: 90 }], []);
        assert.ok(html.includes('1h 30m'));
    });

    it('formats zero duration as 0m', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 1, name: 'X', durationMin: 0 }], []);
        assert.ok(html.includes('0m'));
    });

    it('shows overflow badge when more than 3 total items', () => {
        const entries = [1, 2, 3, 4].map(i => ({ appid: i, name: `G${i}`, durationMin: 10 }));
        const html = buildCell(2026, 4, 17, false, entries, []);
        assert.ok(html.includes('+1'));
    });

    it('releases appear before play entries in the display', () => {
        const html = buildCell(2026, 4, 17, false,
            [{ appid: 1, name: 'Game', durationMin: 60 }],
            [{ appid: 2, name: 'Release' }]
        );
        const releaseIdx = html.indexOf('Release');
        const gameIdx    = html.indexOf('Game');
        assert.ok(releaseIdx < gameIdx, 'release entry should appear before play entry');
    });

    it('entries are sorted by durationMin descending', () => {
        const entries = [
            { appid: 1, name: 'Short',  durationMin: 10 },
            { appid: 2, name: 'Medium', durationMin: 50 },
            { appid: 3, name: 'Long',   durationMin: 90 },
        ];
        const html = buildCell(2026, 4, 17, false, entries, []);
        const longIdx   = html.indexOf('Long');
        const mediumIdx = html.indexOf('Medium');
        assert.ok(longIdx < mediumIdx, 'longer session should appear first');
    });
});

// ── buildMonth ────────────────────────────────────────────────────────────────

describe('buildMonth', () => {
    it('renders a month container with the correct name', () => {
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), new Map(), 'play');
        assert.ok(html.includes('cal-month'));
        assert.ok(html.includes('May'));
    });

    it('marks the current month with id="cal-month-current"', () => {
        const html = buildMonth(2026, 4, 'May', '2026-05-17', new Map(), new Map(), 'play');
        assert.ok(html.includes('id="cal-month-current"'));
    });

    it('does not mark a non-current month', () => {
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), new Map(), 'play');
        assert.ok(!html.includes('id="cal-month-current"'));
    });

    it('includes all day-of-week headers', () => {
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), new Map(), 'play');
        for (const dow of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
            assert.ok(html.includes(`<div class="cal-dow">${dow}</div>`), `missing ${dow}`);
        }
    });

    it('generates empty leading cells for the first day-of-week offset', () => {
        // May 2026: May 1 is a Friday (index 5) → 5 leading empty cells
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), new Map(), 'play');
        const emptyCount = (html.match(/cal-cell--empty/g) ?? []).length;
        assert.ok(emptyCount >= 5, `expected ≥5 empty cells, got ${emptyCount}`);
    });

    it('in play mode, shows played entries from dayMap', () => {
        const dayMap = new Map([['2026-05-17', [{ appid: 570, name: 'Dota 2', durationMin: 60 }]]]);
        const html = buildMonth(2026, 4, 'May', '2026-06-01', dayMap, new Map(), 'play');
        assert.ok(html.includes('cal-cell--played'));
        assert.ok(html.includes('Dota 2'));
    });

    it('in releases mode, shows release entries from releaseMap', () => {
        const releaseMap = new Map([['2026-05-17', [{ appid: 440, name: 'TF2' }]]]);
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), releaseMap, 'releases');
        assert.ok(html.includes('cal-cell--release-day'));
    });

    it('in releases mode, does not show play entries', () => {
        const dayMap    = new Map([['2026-05-17', [{ appid: 570, name: 'Dota 2', durationMin: 60 }]]]);
        const html = buildMonth(2026, 4, 'May', '2026-06-01', dayMap, new Map(), 'releases');
        assert.ok(!html.includes('cal-cell--played'));
    });
});
