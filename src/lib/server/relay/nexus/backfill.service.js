// Ported verbatim from relay-server src/services/nexus/backfill.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + the
// data-dir helper rewritten onto featureDir()).
//
// Adult-mod image backfill. Adult mods are gated behind a Nexus login (see
// session.service.js); once a session is captured, this job walks every game the user has
// opened (cached Nexus entries), enumerates its adult mods, and scrapes each one's
// author-images tab so the images are mirrored locally and served forever after.
//
// It's deliberately slow — the scraper is serialized + ~6s apart to stay polite — so the
// job is resumable: a flat queue with a cursor persisted to disk, progress polled by the
// UI. If the session dies mid-run the scraper flags it and we pause; resuming after a
// re-login continues from the cursor. No image is re-scraped (a mod with authorImagesAt
// is skipped), so restarts are cheap.
import fs from 'fs/promises';
import path from 'path';
import logger from '../../logger.js';
import { featureDir } from '../shared/data-root.js';
import { getIndex, listAdultModIds, backfillAuthorImages } from './nexus.service.js';
import { sessionStatus } from './session.service.js';

function statePath() { return path.join(featureDir('nexus'), 'backfill.json'); }

// Per-game cap on adult mods enumerated (most-endorsed first). Bounds outliers like
// Skyrim (18k+ adult mods) so a run is hours, not days. Configurable.
const PER_GAME_CAP = Number(process.env.NEXUS_BACKFILL_PER_GAME_CAP) || 500;

// idle | building | running | paused | done | error
let _state = null;
let _running = false;        // a loop is actively iterating
let _pauseRequested = false;

function blankState() {
    return { status: 'idle', total: 0, done: 0, added: 0, gatedGames: 0,
             cursor: 0, queue: [], games: [], currentAppid: null, currentGame: null,
             startedAt: null, updatedAt: null, pausedReason: null };
}

async function loadState() {
    if (_state) return _state;
    try { _state = JSON.parse(await fs.readFile(statePath(), 'utf8')); }
    catch { _state = blankState(); }
    // A persisted running/building status means a prior process died mid-run — nothing is
    // actually running now, so present it as paused so the UI can resume.
    if (_state.status === 'running' || _state.status === 'building') {
        _state.status = 'paused';
        _state.pausedReason = 'interrupted';
    }
    return _state;
}

let _writeChain = Promise.resolve();
async function persist() {
    if (!_state) return;
    _state.updatedAt = new Date().toISOString();
    const snap = JSON.stringify(_state);
    _writeChain = _writeChain.then(async () => {
        await fs.mkdir(path.dirname(statePath()), { recursive: true }).catch(() => {});
        await fs.writeFile(statePath(), snap).catch(err => logger.warn('[nexus] backfill persist failed', { err: err.message }));
    });
    return _writeChain;
}

// Public status (queue omitted — it can be thousands of entries).
export async function getBackfillStatus() {
    const s = await loadState();
    const { queue, ...rest } = s;
    return { ...rest, running: _running, perGameCap: PER_GAME_CAP };
}

// Build the work list: for every opened game on Nexus, enumerate its adult mods.
async function buildQueue() {
    const index = await getIndex();
    const games = index.filter(g => g.domainName);
    _state.status = 'building';
    _state.games  = games.map(g => ({ appid: g.appid, name: g.steamName, domainName: g.domainName }));
    await persist();

    const queue = [];
    for (const g of _state.games) {
        if (_pauseRequested) break;
        try {
            const ids = await listAdultModIds(g.domainName, { cap: PER_GAME_CAP });
            for (const modId of ids) queue.push({ appid: g.appid, name: g.name, domainName: g.domainName, modId });
            _state.total = queue.length;
            await persist();
            logger.info('[nexus] backfill enumerated', { game: g.name, adult: ids.length, total: queue.length });
        } catch (err) {
            logger.warn('[nexus] backfill enumerate failed', { game: g.name, err: err.message });
        }
    }
    _state.queue  = queue;
    _state.total  = queue.length;
    _state.cursor = 0;
    _state.done   = 0;
    _state.added  = 0;
    await persist();
}

async function runLoop() {
    if (_running) return;
    _running = true;
    _state.status    = 'running';
    _state.startedAt = _state.startedAt ?? new Date().toISOString();
    _state.pausedReason = null;
    await persist();

    try {
        while (_state.cursor < _state.queue.length) {
            if (_pauseRequested) { _state.status = 'paused'; _state.pausedReason = 'manual'; break; }

            const item = _state.queue[_state.cursor];
            _state.currentAppid = item.appid;
            _state.currentGame  = item.name;

            let res;
            try { res = await backfillAuthorImages(item.appid, item.modId, { name: item.name, domainName: item.domainName }); }
            catch (err) { logger.warn('[nexus] backfill item failed', { ...item, err: err.message }); res = {}; }

            if (res?.gated) {
                // The session died — stop and flag for re-login. Cursor stays put so a
                // resume after re-connecting picks up exactly here.
                _state.status = 'paused';
                _state.pausedReason = 'session-expired';
                _state.gatedGames = (_state.gatedGames || 0) + 1;
                logger.warn('[nexus] backfill paused — session expired', { at: _state.cursor });
                break;
            }

            _state.cursor += 1;
            _state.done   += 1;
            _state.added  += res?.added ?? 0;
            if (_state.cursor % 5 === 0) await persist();   // throttle disk
        }

        if (_state.cursor >= _state.queue.length && _state.status === 'running') {
            _state.status = 'done';
            _state.currentAppid = null; _state.currentGame = null;
        }
    } catch (err) {
        _state.status = 'error';
        _state.pausedReason = err.message;
        logger.error('[nexus] backfill loop crashed', { err: err.message });
    } finally {
        _running = false;
        _pauseRequested = false;
        await persist();
    }
}

// Start or resume the backfill. Rebuilds the queue only when there isn't a resumable one.
export async function startBackfill({ rebuild = false } = {}) {
    await loadState();
    if (_running) return getBackfillStatus();

    const sess = await sessionStatus();
    if (!sess.present || sess.status !== 'active') {
        return { ...(await getBackfillStatus()), status: _state.status, blocked: 'needs-session' };
    }

    _pauseRequested = false;
    const hasResumable = _state.queue.length > 0 && _state.cursor < _state.queue.length && !rebuild;

    // Enumerating adult mods across every game can take a while (paginated API calls), and
    // the scrape loop runs for hours — so do it all in the background and return at once.
    // The UI polls status (building → running → done); blocking here made Start look dead.
    if (!hasResumable) {
        _state = blankState();
        _state.status = 'building';
        _state.startedAt = new Date().toISOString();
        await persist();
    }
    (async () => {
        if (!hasResumable) {
            await buildQueue();
            if (_pauseRequested) { _state.status = 'paused'; _state.pausedReason = 'manual'; await persist(); return; }
        }
        await runLoop();
    })().catch(err => logger.error('[nexus] backfill start failed', { err: err.message }));

    return getBackfillStatus();
}

export async function pauseBackfill() {
    await loadState();
    _pauseRequested = true;
    if (!_running) { _state.status = 'paused'; _state.pausedReason = 'manual'; await persist(); }
    return getBackfillStatus();
}

export async function resetBackfill() {
    _pauseRequested = true;
    _state = blankState();
    await persist();
    return getBackfillStatus();
}
