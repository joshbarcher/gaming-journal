// @ts-nocheck — the guides services are untyped .js, same as the sibling suites.
//
// Server-persisted per-map layer filters. The behaviour that matters is the
// null-vs-empty distinction (never saved vs deliberately all-off) and that one
// map's filters can't clobber another's, since a game can ship many maps.
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { getMapPrefs, setMapPrefs } from '../../../lib/server/relay/guides/map-prefs.service.js';

let tmp;
let prevDataDir;

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'map-prefs-'));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmp;
});

afterEach(async () => {
    process.env.DATA_DIR = prevDataDir;
    await fs.rm(tmp, { recursive: true, force: true });
});

const ARGS = ['1623730', 'ign', 'palworld', 'palpagos-islands'];

describe('map prefs', () => {
    it('reports never-saved as null rather than an empty selection', async () => {
        const prefs = await getMapPrefs(...ARGS);
        assert.equal(prefs.enabled, null);
        assert.deepEqual(prefs.collapsedGroups, []);
    });

    it('round-trips a saved selection', async () => {
        await setMapPrefs(...ARGS, { enabled: ['10308', '10279'], collapsedGroups: ['1690'] });
        const prefs = await getMapPrefs(...ARGS);
        assert.deepEqual(prefs.enabled, ['10308', '10279']);
        assert.deepEqual(prefs.collapsedGroups, ['1690']);
        assert.ok(prefs.updatedAt);
    });

    // The distinction the client depends on: [] must survive as [], because falling
    // back to IGN's defaults here would silently switch 43 layers back on every time
    // someone deliberately cleared them.
    it('keeps an all-off selection distinct from never-saved', async () => {
        await setMapPrefs(...ARGS, { enabled: [], collapsedGroups: [] });
        const prefs = await getMapPrefs(...ARGS);
        assert.deepEqual(prefs.enabled, []);
        assert.notEqual(prefs.enabled, null);
    });

    it('keys per map, so sibling maps do not share filters', async () => {
        await setMapPrefs('1623730', 'ign', 'palworld', 'map-a', { enabled: ['a'] });
        await setMapPrefs('1623730', 'ign', 'palworld', 'map-b', { enabled: ['b'] });
        assert.deepEqual((await getMapPrefs('1623730', 'ign', 'palworld', 'map-a')).enabled, ['a']);
        assert.deepEqual((await getMapPrefs('1623730', 'ign', 'palworld', 'map-b')).enabled, ['b']);
    });

    it('keys per guide and per game', async () => {
        await setMapPrefs('111', 'ign', 'g1', 'm', { enabled: ['x'] });
        await setMapPrefs('222', 'ign', 'g1', 'm', { enabled: ['y'] });
        assert.deepEqual((await getMapPrefs('111', 'ign', 'g1', 'm')).enabled, ['x']);
        assert.deepEqual((await getMapPrefs('222', 'ign', 'g1', 'm')).enabled, ['y']);
    });

    it('rejects a malformed enabled payload instead of persisting it', async () => {
        // A null here would be indistinguishable from never-saved once stored, so it
        // must fail loudly rather than quietly resetting the user's filters.
        await expect(setMapPrefs(...ARGS, { enabled: null })).rejects.toThrow(/enabled must be/);
        await expect(setMapPrefs(...ARGS, { enabled: 'nope' })).rejects.toThrow(/enabled must be/);
    });

    it('dedupes and coerces slugs', async () => {
        await setMapPrefs(...ARGS, { enabled: ['a', 'a', 'b'], collapsedGroups: ['g', 'g'] });
        const prefs = await getMapPrefs(...ARGS);
        assert.deepEqual(prefs.enabled, ['a', 'b']);
        assert.deepEqual(prefs.collapsedGroups, ['g']);
    });

    it('overwrites rather than merging on re-save', async () => {
        await setMapPrefs(...ARGS, { enabled: ['a', 'b', 'c'] });
        await setMapPrefs(...ARGS, { enabled: ['a'] });
        assert.deepEqual((await getMapPrefs(...ARGS)).enabled, ['a']);
    });

    it('serialises concurrent writes without losing entries', async () => {
        // Two tabs saving different maps at once must both survive — the read-modify-write
        // is locked precisely so one doesn't overwrite the other's key.
        await Promise.all([
            setMapPrefs('1', 'ign', 'g', 'm1', { enabled: ['1'] }),
            setMapPrefs('1', 'ign', 'g', 'm2', { enabled: ['2'] }),
            setMapPrefs('1', 'ign', 'g', 'm3', { enabled: ['3'] }),
        ]);
        assert.deepEqual((await getMapPrefs('1', 'ign', 'g', 'm1')).enabled, ['1']);
        assert.deepEqual((await getMapPrefs('1', 'ign', 'g', 'm2')).enabled, ['2']);
        assert.deepEqual((await getMapPrefs('1', 'ign', 'g', 'm3')).enabled, ['3']);
    });

    it('stores alongside journal data, not inside the scraped map tree', async () => {
        // Filters must survive a map re-download, which rewrites everything under _maps/.
        await setMapPrefs(...ARGS, { enabled: ['a'] });
        const onDisk = path.join(tmp, 'gaming-journal', 'guide-map-prefs.json');
        const raw = JSON.parse(await fs.readFile(onDisk, 'utf8'));
        assert.ok(raw['1623730:ign:palworld:palpagos-islands']);
    });
});
