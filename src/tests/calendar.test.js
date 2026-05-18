import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _buildDayMap, _localDateStr, _splitAtMidnight } from '../../public/js/views/calendar.js';

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
