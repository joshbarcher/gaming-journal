/**
 * Tracker suggestion job queue.
 *
 * Ported verbatim from relay-server src/services/progress-suggest/suggest-job-queue.js
 * (docs/relay-fold-in.md §6). Two deliberate deviations, both flagged in the plan:
 *  - JOURNAL_URL now defaults to SELF (http://localhost:$PORT) — after the fold-in
 *    the journal and the suggest queue are the same process, so the tracker-save
 *    POST loops back over localhost. Replacing the HTTP hop with a direct call to
 *    the pages service is a follow-up: /api/pages' POST handler carries validation
 *    + task-id normalization that would have to move into a shared service first.
 *  - SSE clients are transport-agnostic writers ({ write, writableEnded, on }) —
 *    the SvelteKit route adapts a ReadableStream controller onto that shape, so
 *    broadcast/addSseClient logic is unchanged from the express version.
 *
 * In-memory queue of AI tracker-suggest jobs. Progress is broadcast to all
 * connected SSE clients so any browser tab stays in sync.
 */

import { randomUUID }             from 'node:crypto';
import { suggestTrackersViaCli }  from './progress-suggest-cli.service.js';
import logger                     from '../../logger.js';

// The only path: pipe the prompt through the `claude` CLI (bills against the
// Max subscription). There is deliberately no Anthropic-API fallback.
const _suggest = suggestTrackersViaCli;

const _jobs    = [];
const _clients = new Set();

// ── SSE broadcast ─────────────────────────────────────────────────────────────

function broadcast(job) {
    const data = `data: ${JSON.stringify(job)}\n\n`;
    for (const res of _clients) {
        if (!res.writableEnded) res.write(data);
        else _clients.delete(res);
    }
}

// Lightweight per-line delta so streaming logs don't re-send the whole job
// (with its growing log array) on every line. Late-joining tabs still get the
// full log via the snapshot on connect.
function broadcastLog(id, line) {
    const data = `data: ${JSON.stringify({ type: 'log', id, line })}\n\n`;
    for (const res of _clients) {
        if (!res.writableEnded) res.write(data);
        else _clients.delete(res);
    }
}

const LOG_CAP = 300;

export function addSseClient(res) {
    // Send current snapshot on connect so the client is immediately up to date
    res.write(`data: ${JSON.stringify({ type: 'snapshot', jobs: _jobs })}\n\n`);
    _clients.add(res);
    res.on('close', () => _clients.delete(res));
}

// ── Public queue API ──────────────────────────────────────────────────────────

export function getJobs() {
    return _jobs;
}

export function enqueueJob({ steamId, gameName }) {
    // Deduplicate: return existing active job for this game
    const existing = _jobs.find(j =>
        j.steamId === String(steamId) &&
        (j.status === 'pending' || j.status === 'running')
    );
    if (existing) return existing;

    const job = {
        id:          randomUUID(),
        steamId:     String(steamId),
        gameName:    gameName ?? '',
        status:      'pending',
        progress:    0,
        log:         [],
        trackers:    null,
        createdAt:   new Date().toISOString(),
        startedAt:   null,
        completedAt: null,
        error:       null,
    };

    _jobs.push(job);
    broadcast(job);
    _runJob(job);
    return job;
}

export function cancelJob(jobId) {
    const job = _jobs.find(j => j.id === jobId);
    if (!job || job.status !== 'pending') return false;
    _patch(job, { status: 'cancelled', completedAt: new Date().toISOString() });
    return true;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _patch(job, fields) {
    Object.assign(job, fields);
    broadcast(job);
}

// Append a line to the job log and stream it to live clients (same path the
// CLI 'log' events use). Used to make the persist phase visible in the UI.
function _appendLog(job, line) {
    job.log.push(line);
    if (job.log.length > LOG_CAP) job.log.shift();
    broadcastLog(job.id, line);
}

async function _persistTrackerPages(job) {
    // Fold-in: default to self — the journal's own /api/pages lives in this process.
    const base = (process.env.JOURNAL_URL ?? `http://localhost:${process.env.PORT ?? '5173'}`).replace(/\/$/, '');
    const total = job.trackers.length;
    let created = 0;
    const failures = [];

    _appendLog(job, `💾 Saving ${total} trackers to the journal (${base})…`);
    for (const tracker of job.trackers) {
        try {
            const res = await fetch(`${base}/api/pages`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ ...tracker, appid: job.steamId }),
            });
            if (res.ok) created++;
            else {
                failures.push({ title: tracker.title, err: `HTTP ${res.status}` });
                _appendLog(job, `⚠️  Save failed: ${tracker.title} — HTTP ${res.status}`);
                logger.error('Page create failed', { title: tracker.title, status: res.status });
            }
        } catch (err) {
            failures.push({ title: tracker.title, err: err.message });
            _appendLog(job, `⚠️  Save failed: ${tracker.title} — ${err.message}`);
            logger.error('Page create request failed', { title: tracker.title, err: err.message });
        }
    }
    logger.info('Tracker pages persisted', { gameName: job.gameName, created, total, failed: failures.length });
    return { created, total, failures };
}

async function _runJob(job) {
    _patch(job, { status: 'running', startedAt: new Date().toISOString() });

    try {
        const trackers = await _suggest(job.gameName, (event) => {
            if (event.type === 'tick') {
                // Progress is blended (time + real tool activity) by the CLI service.
                if (typeof event.progress === 'number') _patch(job, { progress: event.progress });
            } else if (event.type === 'log') {
                _appendLog(job, event.line);
            }
            // 'start'/'searching'/'writing' are already reflected in the log stream.
        });

        job.trackers = trackers;

        // Persist BEFORE declaring success so the job's final state reflects
        // whether the trackers actually made it into the journal — a silent
        // save failure must not masquerade as 'done'.
        const { created, total, failures } = await _persistTrackerPages(job);

        if (total > 0 && created === 0) {
            const why = failures[0]?.err ?? 'save failed';
            _appendLog(job, `❌ Saved 0/${total} trackers — ${why}`);
            _patch(job, {
                status:      'error',
                progress:    100,
                trackers,
                completedAt: new Date().toISOString(),
                error:       `Generated ${total} trackers but none could be saved to the journal (${why})`,
            });
            return;
        }

        _appendLog(job, failures.length
            ? `⚠️  Saved ${created}/${total} trackers — ${failures.length} failed`
            : `✅ Saved ${created}/${total} trackers to the journal`);
        _patch(job, {
            status:      'done',
            progress:    100,
            trackers,
            completedAt: new Date().toISOString(),
        });
    } catch (err) {
        logger.error('Tracker suggest job failed', err);
        _patch(job, {
            status:      'error',
            completedAt: new Date().toISOString(),
            error:       err.message,
        });
    }
}
