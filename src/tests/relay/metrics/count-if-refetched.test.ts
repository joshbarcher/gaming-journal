// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/count-if-refetched.test.js (node:test → vitest).
//
// PARTIAL PORT — Wave-4 split. The relay file tests two helpers from
// steam/sessions.service.js:
//   - countIfRefetched: NOT ported. It lives in (and is only consumed by)
//     sessions.service.js, which stays relay-owned until Wave 4. Its describe
//     block (8 tests) ports alongside the sessions service — the relay copy of
//     this file keeps running against it until then.
//   - countNewIds: ported below, verbatim, against the copy inlined into
//     metrics/actions.js (its only journal-side consumer is the steam:library
//     action's novelty diff — see the provenance comment in actions.js).
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-refetch-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;

import { countNewIds } from '../../../lib/server/relay/metrics/actions.js';

describe('countNewIds', () => {
    test('counts ids present after but not before', () => {
        assert.equal(countNewIds([1, 2, 3], [1, 2, 3, 4, 5]), 2);
    });

    test('a re-fetch of the same library creates nothing', () => {
        assert.equal(countNewIds([1, 2, 3], [3, 2, 1]), 0);
    });

    test('a first sync makes every id new', () => {
        assert.equal(countNewIds([], [1, 2]), 2);
    });

    test('removed ids do not count as new', () => {
        assert.equal(countNewIds([1, 2, 3], [1]), 0);
    });

    test('works with string keys, as the wishlist items map produces', () => {
        assert.equal(countNewIds(['440'], ['440', '570']), 1);
    });
});
