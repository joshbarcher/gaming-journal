// @ts-nocheck — exercises the untyped pins.service re-anchor logic; assertions are
// runtime-verified by vitest.
//
// Durable pins: instead of wiping every pin when a guide is re-parsed (parsedAt changes),
// the service re-anchors each pin to the new content by matching its stored text `label`
// against _fulltext.json (which maps blocks → {slug, text, blockPath}). blockPath is a
// hint; text is identity. These tests cover the pure matcher (reanchorPinList) and the
// self-healing getPins() path.
//
// DATA_DIR must point at a temp dir (never the NAS): pins live at
// $DATA_DIR/gaming-journal/guide-pins.json and guide data at $DATA_DIR/relay/guides/…
import { describe, it, beforeAll as before, afterAll as after, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import path   from 'node:path';
import os     from 'node:os';
import fs     from 'node:fs/promises';

let tmpDir;
let svc;

const STEAM = '441', SRC = 'ign', GUIDE = 'reanchor-guide';

// One _fulltext.json entry. Its `label` is the PAGE label (matching production) — matching
// keys off `text`, never `label`.
const ft = (slug, text, blockPath) => ({ slug, label: 'PageLabel', text, blockPath });

before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pins-reanchor-'));
    process.env.DATA_DIR = tmpDir;
    delete process.env.RELAY_DATA_ROOT;
    svc = await import('../../../lib/server/relay/guides/pins.service.js');
});

after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
    await fs.rm(path.join(tmpDir, 'gaming-journal', 'guide-pins.json'), { force: true });
});

// ── Pure matcher ───────────────────────────────────────────────────────────────

describe('reanchorPinList', () => {
    const pinOn = (slug, blockPath, label) => ({ id: 'p', slug, pageLabel: '', blockPath, label });

    it('unchanged page: identical text keeps the same blockPath', () => {
        const out = svc.reanchorPinList(
            [pinOn('p1', [0], 'June will have us')],
            [ft('p1', 'June will have us continuing our battle', [0])],
        );
        assert.deepEqual(out[0].blockPath, [0]);
    });

    it('moved block: same text now at a new blockPath → heals to it', () => {
        const out = svc.reanchorPinList(
            [pinOn('p1', [0], 'June will have us')],
            [ft('p1', 'Intro paragraph', [0]), ft('p1', 'June will have us continuing', [2])],
        );
        assert.deepEqual(out[0].blockPath, [2]);
    });

    it('removed block: no matching text → pin left unchanged (client flags it)', () => {
        const out = svc.reanchorPinList(
            [pinOn('p1', [3], 'This block was deleted')],
            [ft('p1', 'Some other content', [0])],
        );
        assert.deepEqual(out[0].blockPath, [3]);
    });

    it('non-unique label: tie-breaks to the candidate nearest the old path (stable)', () => {
        const entries = [ft('p1', 'See the boss guide', [1]), ft('p1', 'See the boss guide', [5])];
        assert.deepEqual(svc.reanchorPinList([pinOn('p1', [5], 'See the boss guide')], entries)[0].blockPath, [5]);
        assert.deepEqual(svc.reanchorPinList([pinOn('p1', [1], 'See the boss guide')], entries)[0].blockPath, [1]);
    });

    it('page renamed / gone: no entries for the slug → unchanged', () => {
        const out = svc.reanchorPinList(
            [pinOn('old-page', [0], 'text')],
            [ft('new-page', 'text', [0])],
        );
        assert.deepEqual(out[0].blockPath, [0]);
    });

    it('table/list: a label that is a substring of the block text → contains-match heals', () => {
        const out = svc.reanchorPinList(
            [pinOn('p1', [0], 'Bring a Muscle Drink')],
            [ft('p1', 'Number Request Reward · Bring a Muscle Drink · x5 Soul Drop', [4])],
        );
        assert.deepEqual(out[0].blockPath, [4]);
    });

    it('normalizes trailing ellipsis and native type-prefixes before matching', () => {
        const out = svc.reanchorPinList(
            [
                pinOn('p1', [9], 'Head to Tartarus for final prep…'),
                pinOn('p1', [9], 'List: Amateur Protein'),
            ],
            [
                ft('p1', 'Head to Tartarus for final prep and grind levels', [1]),
                ft('p1', 'Amateur Protein can be traded to Elizabeth', [2]),
            ],
        );
        assert.deepEqual(out[0].blockPath, [1]);
        assert.deepEqual(out[1].blockPath, [2]);
    });

    it('pin without a label is left untouched (nothing to match on)', () => {
        const out = svc.reanchorPinList([pinOn('p1', [7], '')], [ft('p1', 'anything', [0])]);
        assert.deepEqual(out[0].blockPath, [7]);
    });
});

// ── Self-healing getPins ─────────────────────────────────────────────────────────

describe('getPins re-anchors on re-parse', () => {
    async function writeGuide(parsedAt, fulltext) {
        const gdir = path.join(tmpDir, 'relay', 'guides', STEAM, SRC, GUIDE);
        await fs.mkdir(gdir, { recursive: true });
        await fs.writeFile(path.join(gdir, '_meta.json'), JSON.stringify({ parsedAt }));
        await fs.writeFile(path.join(gdir, '_fulltext.json'), JSON.stringify(fulltext));
    }

    it('heals a stale pin to the block\'s new position and stamps the new parsedAt', async () => {
        await writeGuide('v2', [
            ft('page-x', 'Some intro text', [0]),
            ft('page-x', 'Defeat the boss on floor 47', [3]),   // moved from [0] to [3]
        ]);
        await svc.setPins(STEAM, SRC, GUIDE, {
            parsedAt: 'v1',
            pins: [{ id: 'a', slug: 'page-x', pageLabel: 'Page X', blockPath: [0], label: 'Defeat the boss on floor 47' }],
        });

        const store = await svc.getPins(STEAM, SRC, GUIDE);
        assert.equal(store.parsedAt, 'v2');
        assert.equal(store.pins.length, 1, 'the pin survives the re-parse');
        assert.deepEqual(store.pins[0].blockPath, [3], 're-anchored to the block\'s new blockPath');
    });

    it('leaves pins untouched when parsedAt already matches (no needless rewrite)', async () => {
        await writeGuide('v2', [ft('page-x', 'stable text', [1])]);
        await svc.setPins(STEAM, SRC, GUIDE, {
            parsedAt: 'v2',
            pins: [{ id: 'a', slug: 'page-x', pageLabel: 'Page X', blockPath: [1], label: 'stable text' }],
        });
        const store = await svc.getPins(STEAM, SRC, GUIDE);
        assert.equal(store.parsedAt, 'v2');
        assert.deepEqual(store.pins[0].blockPath, [1]);
    });
});
