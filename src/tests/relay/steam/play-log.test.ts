// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/play-log.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly.
//
// play-log.service is a Wave-4 file ported early as a read dependency (see its
// header); this suite exercises the write half too, against a temp DATA_DIR
// only — writes outside tests stay relay-owned until Wave 4.
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-relay-play-log-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR

await fs.mkdir(path.join(tmpDir, 'relay', 'steam'), { recursive: true });

const {
    openSession,
    closeSession,
    clearOpenSession,
    getOpenSession,
    getSessions,
    getEffectivePlaytimeMin,
    getLastPlayedMap,
} = await import('../../../lib/server/relay/steam/play-log.service.js');

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── openSession / getOpenSession ──────────────────────────────────────────────

describe('play-log — openSession', () => {
    it('persists an open session to disk', async () => {
        await openSession(570, 'Dota 2', '2026-05-17T21:00:00.000Z');
        const open = await getOpenSession();
        assert.equal(open.appid, 570);
        assert.equal(open.name, 'Dota 2');
        assert.equal(open.startedAt, '2026-05-17T21:00:00.000Z');
    });

    it('sets the open session for a game that has no prior open session', async () => {
        // Each game tracks its own open session independently.
        // Mutual exclusion (close prev before opening next) is enforced by
        // the now-playing poller, not by openSession() itself.
        await clearOpenSession();
        await openSession(730, 'CS2', '2026-05-17T22:00:00.000Z');
        const open = await getOpenSession();
        assert.equal(open.appid, 730);
    });
});

// ── closeSession ──────────────────────────────────────────────────────────────

describe('play-log — closeSession', () => {
    beforeAll(async () => {
        // Ensure only 730 is open so getOpenSession() is unambiguous.
        await clearOpenSession();
        await openSession(730, 'CS2', '2026-05-17T22:00:00.000Z');
    });

    it('closes the open session and records it with correct duration', async () => {
        await closeSession(730, '2026-05-17T23:00:00.000Z');

        const open = await getOpenSession();
        assert.equal(open, null);

        const sessions = await getSessions();
        assert.ok(sessions[730]);
        assert.equal(sessions[730].sessions.length, 1);
        assert.equal(sessions[730].sessions[0].durationMin, 60);
        assert.equal(sessions[730].sessions[0].startedAt, '2026-05-17T22:00:00.000Z');
        assert.equal(sessions[730].sessions[0].endedAt,   '2026-05-17T23:00:00.000Z');
    });

    it('is a no-op when appid does not match the open session', async () => {
        await openSession(570, 'Dota 2', '2026-05-17T21:00:00.000Z');
        await closeSession(999, '2026-05-17T21:30:00.000Z');
        const open = await getOpenSession();
        assert.equal(open?.appid, 570);
    });

    it('accumulates multiple completed sessions', async () => {
        await openSession(570, 'Dota 2', '2026-05-17T21:00:00.000Z');
        await closeSession(570, '2026-05-17T21:45:00.000Z');

        const sessions = await getSessions();
        const dota = sessions[570];
        assert.ok(dota);
        assert.ok(dota.sessions.length >= 1);
    });

    it('enforces minimum 1-minute duration', async () => {
        await openSession(440, 'TF2', '2026-05-17T20:00:00.000Z');
        await closeSession(440, '2026-05-17T20:00:10.000Z'); // only 10 seconds
        const sessions = await getSessions();
        assert.equal(sessions[440].sessions[0].durationMin, 1);
    });
});

// ── clearOpenSession ──────────────────────────────────────────────────────────

describe('play-log — clearOpenSession', () => {
    it('clears an existing open session without adding it to completed', async () => {
        await openSession(240, 'Left 4 Dead 2', '2026-05-17T20:00:00.000Z');

        // Count only CLOSED sessions — getSessions() now also returns the open
        // session, so we filter to endedAt !== null to measure "completed" count.
        const closedBefore = (getSessions()[240]?.sessions ?? []).filter(s => s.endedAt !== null).length;

        await clearOpenSession();

        const open = await getOpenSession();
        assert.equal(open, null);

        const closedAfter = (getSessions()[240]?.sessions ?? []).filter(s => s.endedAt !== null).length;
        assert.equal(closedAfter, closedBefore); // cleared session not added to completed
    });

    it('is a no-op when there is no open session', async () => {
        await clearOpenSession(); // should not throw
        const open = await getOpenSession();
        assert.equal(open, null);
    });
});

// ── cross-midnight sessions ───────────────────────────────────────────────────

describe('play-log — cross-midnight session', () => {
    it('records full duration when session spans midnight', async () => {
        await openSession(400, 'Portal 2', '2026-05-17T23:00:00.000Z');
        await closeSession(400, '2026-05-18T02:00:00.000Z');

        const sessions = await getSessions();
        const s = sessions[400].sessions[0];
        assert.equal(s.durationMin, 180);
        assert.equal(s.startedAt, '2026-05-17T23:00:00.000Z');
        assert.equal(s.endedAt,   '2026-05-18T02:00:00.000Z');
    });

    it('attributes the session to the start date (May 17), not the end date', async () => {
        const sessions = await getSessions();
        const s = sessions[400].sessions[0];
        const startDay = new Date(s.startedAt).toISOString().slice(0, 10);
        assert.equal(startDay, '2026-05-17');
    });
});

// ── getSessions shape ─────────────────────────────────────────────────────────

describe('play-log — getSessions', () => {
    it('returns empty object when no completed sessions exist', async () => {
        const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-relay-play-log-empty-'));
        await fs.mkdir(path.join(emptyDir, 'relay', 'steam'), { recursive: true });
        const origDataDir = process.env.DATA_DIR;
        process.env.DATA_DIR = emptyDir;

        try {
            // The relay original busts the module cache with a ?fresh=<ts>
            // query, which Vite's dynamic-import analysis rejects —
            // vi.resetModules() achieves the same fresh-module-instance
            // intent (top-level bindings held by the other suites are
            // unaffected; only future imports re-evaluate).
            vi.resetModules();
            const { getSessions: getEmpty } = await import(
                '../../../lib/server/relay/steam/play-log.service.js'
            );
            const result = await getEmpty();
            assert.deepEqual(result, {});
        } finally {
            process.env.DATA_DIR = origDataDir;
            await fs.rm(emptyDir, { recursive: true, force: true });
        }
    });
});

// ── open session included in getSessions ──────────────────────────────────────

describe('play-log — getSessions includes open session', () => {
    const APPID = 2000;

    beforeAll(async () => {
        await clearOpenSession();
    });

    it('includes the open session with endedAt: null', async () => {
        const startedAt = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago
        await openSession(APPID, 'Test Game', startedAt);

        const sessions = getSessions();
        assert.ok(sessions[APPID], 'game should appear in getSessions while open');

        const open = sessions[APPID].sessions.find(s => s.endedAt === null);
        assert.ok(open, 'open session should have endedAt: null');
        assert.equal(open.startedAt, startedAt);
        assert.ok(open.durationMin >= 5, `durationMin should be >= 5, got ${open.durationMin}`);
    });

    it('includes both closed and open sessions for the same game', async () => {
        // Close the open one and open a new one — should see both
        await closeSession(APPID, new Date().toISOString());
        const startedAt = new Date(Date.now() - 2 * 60_000).toISOString();
        await openSession(APPID, 'Test Game', startedAt);

        const sessions = getSessions();
        const all = sessions[APPID].sessions;
        const closed = all.filter(s => s.endedAt !== null);
        const open   = all.filter(s => s.endedAt === null);
        assert.ok(closed.length >= 1, 'should have at least one closed session');
        assert.equal(open.length, 1, 'should have exactly one open session');
    });

    it('returns game entry even when there are no closed sessions yet', async () => {
        await clearOpenSession();
        const freshAppid  = 2009;
        const startedAt   = new Date(Date.now() - 60_000).toISOString();
        await openSession(freshAppid, 'Brand New Game', startedAt);

        const sessions = getSessions();
        assert.ok(sessions[freshAppid], 'game with only an open session should appear');
        assert.equal(sessions[freshAppid].sessions.length, 1);
        assert.equal(sessions[freshAppid].sessions[0].endedAt, null);
    });

    afterAll(async () => {
        await clearOpenSession();
    });
});

// ── getEffectivePlaytimeMin ───────────────────────────────────────────────────

describe('play-log — getEffectivePlaytimeMin', () => {
    const APPID = 2001;

    beforeAll(async () => {
        await clearOpenSession();
    });

    it('returns 0 for an unknown appid', () => {
        assert.equal(getEffectivePlaytimeMin(99999), 0);
    });

    it('returns only closed session totals when nothing is open', async () => {
        await openSession(APPID, 'Playtime Game', '2026-05-17T10:00:00.000Z');
        await closeSession(APPID, '2026-05-17T11:00:00.000Z'); // 60 min
        const total = getEffectivePlaytimeMin(APPID);
        assert.equal(total, 60);
    });

    it('adds live elapsed time when a session is open', async () => {
        const startedAt = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
        await openSession(APPID, 'Playtime Game', startedAt);

        const total = getEffectivePlaytimeMin(APPID);
        // 60 min (closed) + ~10 min (open) = at least 70
        assert.ok(total >= 70, `expected >= 70, got ${total}`);
        // Shouldn't be wildly large — allow a generous buffer for slow CI
        assert.ok(total < 80, `expected < 80, got ${total}`);
    });

    afterAll(async () => {
        await clearOpenSession();
    });
});

// ── getLastPlayedMap ──────────────────────────────────────────────────────────

describe('play-log — getLastPlayedMap', () => {
    const APPID = 2002;

    beforeAll(async () => {
        await clearOpenSession();
    });

    it('omits games with no sessions at all', () => {
        const map = getLastPlayedMap();
        // appid 99999 has never been seen
        assert.equal(map[99999], undefined);
    });

    it('includes a game with closed sessions', async () => {
        await openSession(APPID, 'LastPlayed Game', '2026-05-17T12:00:00.000Z');
        await closeSession(APPID, '2026-05-17T13:00:00.000Z'); // 60 min

        const map = getLastPlayedMap();
        assert.ok(map[APPID], 'game with closed sessions should appear');
        assert.equal(map[APPID].lastPlayedAt, '2026-05-17T12:00:00.000Z');
        assert.equal(map[APPID].effectiveMin, 60);
    });

    it('includes a currently-playing game with live elapsed time', async () => {
        const startedAt = new Date(Date.now() - 15 * 60_000).toISOString(); // 15 min ago
        await openSession(APPID, 'LastPlayed Game', startedAt);

        const map = getLastPlayedMap();
        assert.ok(map[APPID], 'currently-playing game should appear in last-played map');
        assert.equal(map[APPID].lastPlayedAt, startedAt);
        // 60 min (closed) + ~15 min (open) = at least 75
        assert.ok(map[APPID].effectiveMin >= 75, `expected >= 75, got ${map[APPID].effectiveMin}`);
    });

    afterAll(async () => {
        await clearOpenSession();
    });
});
