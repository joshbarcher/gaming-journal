// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/job-guard.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified). Pure in-memory module: no DATA_DIR involved.
import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import { isRunning, begin, end, listRunning, runningSince, setProgress, getProgress, _reset } from '../../../lib/server/relay/metrics/job-guard.js';

beforeEach(() => _reset());

describe('job-guard', () => {
    test('begin claims a free slot', () => {
        assert.equal(isRunning('itad'), false);
        assert.equal(begin('itad'), true);
        assert.equal(isRunning('itad'), true);
    });

    test('a second begin for the same id is refused', () => {
        assert.equal(begin('itad'), true);
        assert.equal(begin('itad'), false, 'overlapping claim must be rejected, not queued');
    });

    test('different ids do not block each other', () => {
        assert.equal(begin('itad'), true);
        assert.equal(begin('hltb'), true);
        assert.deepEqual(listRunning().sort(), ['hltb', 'itad']);
    });

    test('end releases the slot for a later run', () => {
        begin('itad');
        end('itad');
        assert.equal(isRunning('itad'), false);
        assert.equal(begin('itad'), true);
    });

    test('end on an unclaimed id is a no-op', () => {
        end('never-claimed');
        assert.deepEqual(listRunning(), []);
    });

    test('runningSince reports an ISO timestamp while claimed, null otherwise', () => {
        assert.equal(runningSince('itad'), null);
        begin('itad');
        assert.match(runningSince('itad'), /^\d{4}-\d{2}-\d{2}T/);
        end('itad');
        assert.equal(runningSince('itad'), null);
    });

    test('the claim is synchronous, so two callers in one tick cannot both win', () => {
        // startSync() relies on this: it calls begin() before creating any promise.
        const results = [begin('pcgw'), begin('pcgw'), begin('pcgw')];
        assert.deepEqual(results, [true, false, false]);
    });
});

describe('job-guard progress', () => {
    test('a fresh claim has no progress until the sync reports some', () => {
        begin('hltb');
        assert.equal(getProgress('hltb'), null, 'total 0 means indeterminate, not 0%');
    });

    test('setProgress makes the run determinate', () => {
        begin('hltb');
        setProgress('hltb', 3, 10);
        assert.deepEqual(getProgress('hltb'), { done: 3, total: 10 });
    });

    test('progress is not reported for a source that is not running', () => {
        assert.equal(getProgress('hltb'), null);
    });

    test('setProgress on a finished run is a no-op, not a resurrection', () => {
        // A settling sync can fire onProgress after tracked() has already ended.
        begin('hltb');
        setProgress('hltb', 5, 10);
        end('hltb');
        setProgress('hltb', 9, 10);

        assert.equal(isRunning('hltb'), false);
        assert.equal(getProgress('hltb'), null);
    });

    test('progress resets when the same source runs again', () => {
        begin('hltb');
        setProgress('hltb', 9, 10);
        end('hltb');
        begin('hltb');
        assert.equal(getProgress('hltb'), null);
    });

    test('progress is tracked per source', () => {
        begin('hltb');
        begin('itad');
        setProgress('hltb', 1, 4);
        assert.deepEqual(getProgress('hltb'), { done: 1, total: 4 });
        assert.equal(getProgress('itad'), null);
    });
});
