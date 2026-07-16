// Ported verbatim from relay-server src/services/discovery/discovery.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: store path via
// featureDir('steam'), and the worker spawn path is resolved from
// process.cwd() instead of import.meta.url — the adapter-node build relocates
// modules into build/server/chunks, so __dirname-style resolution breaks in
// prod. Both `vite dev` and the prod pm2 process run from the app checkout
// root, which always carries src/ (same precedent as guides/tools-dir.js).
// worker_threads also bypass vite's transform pipeline, so the spawn entry is
// discovery.worker-boot.js — it registers a .js→.ts resolve fallback (the
// chain imports logger.ts via a vite-flavored './logger.js' specifier), then
// loads the verbatim discovery.worker.js.
import path           from 'node:path';
import fs             from 'node:fs/promises';
import { Worker }     from 'node:worker_threads';
import logger         from '../../logger.js';
import { patchName }  from '../steam/player-counts.service.js';
import { featureDir } from '../shared/data-root.js';

const WORKER_PATH = path.join(process.cwd(), 'src', 'lib', 'server', 'relay', 'discovery', 'discovery.worker-boot.js');

function storePath(appid) {
    return path.join(featureDir('steam'), 'store', `${appid}.json`);
}

async function _isEnriched(appid) {
    try {
        const raw = JSON.parse(await fs.readFile(storePath(appid), 'utf8'));
        return !!raw?.name;
    } catch { return false; }
}

// ── Worker ────────────────────────────────────────────────────────────────────

let _worker = null;
const _queued = new Set(); // track what's been sent to the worker

function _getWorker() {
    if (_worker) return _worker;

    _worker = new Worker(WORKER_PATH, {
        workerData: { queue: [] },
    });

    _worker.on('message', msg => {
        if (msg.type === 'done') {
            _queued.delete(msg.appid);
            // Patch the name in the player-counts index in-place — no full rebuild needed.
            // The games cache doesn't need updating either: getOneDiscovered() reads from disk on demand.
            if (msg.name) patchName(msg.appid, msg.name);
            logger.info('[discovery] Enriched', { appid: msg.appid, name: msg.name ?? '(unknown)', remaining: _queued.size });
        } else if (msg.type === 'error') {
            _queued.delete(msg.appid);
            logger.warn('[discovery] Enrichment failed', { appid: msg.appid, err: msg.err });
        }
    });

    _worker.on('error', err => {
        logger.error('[discovery] Worker error', { err: err.message });
        _worker = null; // will respawn on next enqueue
    });

    _worker.on('exit', code => {
        if (code !== 0) logger.warn('[discovery] Worker exited', { code });
        _worker = null;
    });

    return _worker;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function enqueue(appid) {
    const id = Number(appid);
    if (_queued.has(id)) return;
    if (await _isEnriched(id)) return;
    logger.info('[discovery] Queued for enrichment', { appid: id });
    _queued.add(id);
    _getWorker().postMessage({ type: 'enqueue', appid: id });
}

export function queueSize() { return _queued.size; }
