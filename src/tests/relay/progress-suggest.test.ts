// @ts-nocheck — tests over untyped .js services ported from relay-server.
// The relay shipped no progress-suggest test suite; these cover the ported
// pure/disk logic (parseTrackers, buildPrompt, tracker-timings store) without
// ever spawning the claude CLI (docs/relay-fold-in.md §6). The CLI runner and
// the SSE job queue are exercised live at cutover, not here — the queue has no
// injection seam (the CLI path is deliberately hardwired) and stubbing it would
// mean modifying ported code.
import { describe, test, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-progress-suggest-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR

import { buildPrompt, parseTrackers } from '../../lib/server/relay/progress-suggest/progress-suggest.service.js';
import { getEstimatedMs, recordCompletion } from '../../lib/server/relay/progress-suggest/tracker-timings.store.js';

afterAll(async () => {
    await fs.rm(process.env.DATA_DIR, { recursive: true, force: true });
});

// ── buildPrompt ───────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
    test('embeds the game name and the four tracker types', () => {
        const p = buildPrompt('Hollow Knight: Silksong');
        assert.ok(p.includes('"Hollow Knight: Silksong"'));
        for (const t of ['"progress"', '"progress-bars"', '"counter"', '"multi-counter"']) {
            assert.ok(p.includes(t), `prompt must describe ${t}`);
        }
        assert.ok(p.includes('Return ONLY a valid JSON array'));
    });
});

// ── parseTrackers ─────────────────────────────────────────────────────────────

describe('parseTrackers', () => {
    test('parses a bare JSON array and injects ids/state', () => {
        const out = parseTrackers('[{"type":"progress","title":"Chapters","tasks":[{"title":"Ch 1"},{"title":"Ch 2"}]}]');
        assert.equal(out.length, 1);
        assert.equal(out[0].type, 'progress');
        assert.equal(out[0].tasks.length, 2);
        for (const task of out[0].tasks) {
            assert.match(task.id, /^[0-9a-f]{8}$/);
            assert.equal(task.state, null);
        }
    });

    test('strips markdown code fences', () => {
        const out = parseTrackers('```json\n[{"type":"counter","title":"Seeds","target":30}]\n```');
        assert.equal(out.length, 1);
        assert.equal(out[0].type, 'counter');
        assert.equal(out[0].target, 30);
        assert.equal(out[0].current, 0, 'counters start at 0');
    });

    test('skips bracketed prose before the real array', () => {
        const text = 'Based on sources [1] and [wiki], here are the trackers:\n' +
            '[{"type":"multi-counter","title":"Collectibles","counters":[{"name":"Orbs","target":10}]}]';
        const out = parseTrackers(text);
        assert.equal(out.length, 1);
        assert.equal(out[0].type, 'multi-counter');
        assert.match(out[0].counters[0].id, /^[0-9a-f]{8}$/);
        assert.equal(out[0].counters[0].current, 0);
    });

    test('progress-bars get ids on bars and steps', () => {
        const out = parseTrackers('[{"type":"progress-bars","title":"Bonds","bars":[{"title":"A","steps":[{"title":"s1"}]}]}]');
        const bar = out[0].bars[0];
        assert.match(bar.id, /^[0-9a-f]{8}$/);
        assert.match(bar.steps[0].id, /^[0-9a-f]{8}$/);
        assert.equal(bar.steps[0].state, null);
    });

    test('respects strings when balancing brackets', () => {
        const out = parseTrackers('[{"type":"counter","title":"We [like] brackets \\"and \\\\ escapes","target":5}]');
        assert.equal(out[0].title, 'We [like] brackets "and \\ escapes');
    });

    test('throws when no valid JSON array of objects exists', () => {
        assert.throws(() => parseTrackers('Sorry, I could not find completion data.'), /No valid JSON array/);
        assert.throws(() => parseTrackers('[1, 2, 3] is not an object array'), /No valid JSON array/);
        assert.throws(() => parseTrackers(''), /No valid JSON array/);
    });
});

// ── tracker-timings store ─────────────────────────────────────────────────────

describe('tracker-timings store', () => {
    test('defaults to 4 minutes with no samples', async () => {
        assert.equal(await getEstimatedMs(), 4 * 60 * 1000);
    });

    test('records completions and averages them', async () => {
        await recordCompletion(60_000);
        await recordCompletion(120_000);
        assert.equal(await getEstimatedMs(), 90_000);
        // persisted under the feature dir, not the module-load cwd
        const raw = JSON.parse(await fs.readFile(
            path.join(process.env.DATA_DIR, 'relay', 'progress-suggest', 'tracker-timings.json'), 'utf8'));
        assert.deepEqual(raw.durations, [60_000, 120_000]);
    });

    test('caps the sample window at 10 (oldest dropped)', async () => {
        for (let i = 1; i <= 12; i++) await recordCompletion(i * 1000);
        const raw = JSON.parse(await fs.readFile(
            path.join(process.env.DATA_DIR, 'relay', 'progress-suggest', 'tracker-timings.json'), 'utf8'));
        assert.equal(raw.durations.length, 10);
        assert.equal(raw.durations[0], 3000, 'oldest samples fall off the front');
        assert.equal(raw.durations[9], 12_000);
    });
});
