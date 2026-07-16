// Ported verbatim from relay-server src/services/discovery/discovery.worker.js
// (docs/relay-fold-in.md §6). Import rewrites only: the five features plus
// store/images/community-reviews import DIRECTLY from the local ported
// services (the relay's post-Wave-1 copy calls the journal over HTTP via
// journal-sync.js — that shim never existed on this side). This file is loaded
// by node directly (worker_threads bypass vite), so every import here must
// stay plain .js relative paths — no $lib aliases, no .ts.
//
// Runs in a worker_thread — all enrichment I/O happens here, off the main thread.
import { workerData, parentPort } from 'node:worker_threads';
import { syncOne as syncStore }          from '../steam/store.service.js';
import { syncOneGame, syncOneScreenshots } from '../steam/images.service.js';
import { syncGame as syncReviews }       from '../community-reviews/community-reviews.service.js';
import { syncOne as syncItad }           from '../itad/itad.service.js';
import { syncGame as syncPcgw }          from '../pcgw/pcgw.service.js';
import { syncGame as syncHltb }          from '../hltb/hltb.service.js';
import { syncOne as syncProtondb }       from '../protondb/protondb.service.js';

// Inherit env from main thread (worker_threads share process.env)
// workerData carries the initial queue so we can start immediately.

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function enrich(appid) {
    const store     = await syncStore(appid).catch(() => null);
    const steamName = store?.name ?? null;

    await syncOneGame(appid).catch(() => {});
    await syncOneScreenshots(appid).catch(() => {});
    await syncReviews(appid).catch(() => {});

    if (steamName) {
        // Run ITAD and HLTB in parallel with PCGW (Puppeteer) to save wall-clock time
        await Promise.all([
            syncItad(appid, steamName).catch(() => {}),
            syncHltb(appid, { steamName }).catch(() => {}),
            syncPcgw(appid, { steamName }).catch(() => {}),
        ]);
    }

    await syncProtondb(appid, { force: true }).catch(() => {});

    // Tell the main thread this game is done so it can rebuild caches there
    parentPort.postMessage({ type: 'done', appid, name: steamName });
}

// ── Queue loop ────────────────────────────────────────────────────────────────

const _queue = [...(workerData?.queue ?? [])];

parentPort.on('message', msg => {
    if (msg.type === 'enqueue') _queue.push(msg.appid);
});

async function run() {
    while (true) {
        if (_queue.length === 0) {
            await sleep(500); // idle poll
            continue;
        }
        const appid = _queue.shift();
        try {
            await enrich(appid);
        } catch (err) {
            parentPort.postMessage({ type: 'error', appid, err: err.message });
        }
        if (_queue.length > 0) await sleep(2000);
    }
}

run();
