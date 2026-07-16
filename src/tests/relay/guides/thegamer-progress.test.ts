// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/thegamer-progress.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

// The emitter writes to stdout and keeps module-level state, so drive it the way the
// job queue sees it: capture the [PROGRESS] lines and assert on the sequence.
import { __progressForTests } from '../../../lib/server/relay/guides/thegamer/fetcher.js';

const { emitDownload, emitDownloadDone, reset } = __progressForTests;

function capture(fn) {
    const written = [];
    const real = process.stdout.write;
    process.stdout.write = chunk => { written.push(String(chunk)); return true; };
    try { fn(); } finally { process.stdout.write = real; }
    return written
        .filter(l => l.startsWith('[PROGRESS] '))
        .map(l => JSON.parse(l.slice(11)))
        .filter(p => p.bar === 'download')
        .map(p => p.pct);
}

describe('thegamer download progress', () => {
    beforeEach(() => reset());

    it('walks the directory phase across its band', () => {
        const pcts = capture(() => { for (let i = 0; i < 86; i++) emitDownload('directory', i, 86); });
        assert.ok(pcts.length > 1, 'emits as the phase advances');
        assert.ok(pcts[0] <= 2, 'starts near zero');
        assert.ok(pcts.at(-1) <= 40, 'directory phase stays inside its band');
        assert.ok(pcts.at(-1) >= 38, 'directory phase reaches the top of its band');
    });

    it('never rewinds when a new BFS depth enlarges the denominator', () => {
        // This is the whole point: depth 2 adds 215 candidates after depth 1 finished
        // 110, so done/(done+pending) drops sharply. The bar must not go backwards.
        const pcts = capture(() => {
            for (let i = 0; i < 110; i++) emitDownload('bfs', 86 + i, 86 + i + (110 - i));
            for (let i = 0; i < 215; i++) emitDownload('bfs', 196 + i, 196 + i + (215 - i));
        });
        for (let i = 1; i < pcts.length; i++) {
            assert.ok(pcts[i] >= pcts[i - 1], `bar rewound: ${pcts[i - 1]} → ${pcts[i]}`);
        }
    });

    it('never exceeds 99 before completion', () => {
        const pcts = capture(() => { for (let i = 0; i < 50; i++) emitDownload('bfs', i, i); });
        assert.ok(Math.max(...pcts, 0) <= 99);
    });

    it('emits exactly 100 on completion', () => {
        const pcts = capture(() => { emitDownload('bfs', 1, 10); emitDownloadDone(); });
        assert.equal(pcts.at(-1), 100);
    });

    it('does not re-emit an unchanged percentage', () => {
        // One line per real change; the queue broadcasts on every patch.
        const pcts = capture(() => { for (let i = 0; i < 20; i++) emitDownload('directory', 43, 86); });
        assert.deepEqual(pcts, [20]);
    });

    it('stays silent while the percentage is still zero', () => {
        assert.equal(capture(() => { for (let i = 0; i < 5; i++) emitDownload('directory', 0, 86); }).length, 0);
    });

    it('phases stay ordered: directory < tags < bfs', () => {
        const pcts = capture(() => {
            emitDownload('directory', 86, 86);
            emitDownload('tags', 1, 20);
            emitDownload('bfs', 1, 2);
        });
        assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b));
        assert.ok(pcts[0] <= 40 && pcts.at(-1) > 50);
    });
});
