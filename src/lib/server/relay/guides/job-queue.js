/**
 * Guide download job queue.
 *
 * In-memory queue of download jobs. One job per source runs at a time.
 * Progress is broadcast to all connected SSE clients so any browser tab
 * stays in sync regardless of which tab triggered the download.
 */

import { spawn }                 from 'node:child_process';
import { readdir, stat }         from 'node:fs/promises';
import { join }                  from 'node:path';
import { randomUUID }            from 'node:crypto';
import { featureDir }            from '../shared/data-root.js';
import { TOOLS_DIR }             from './tools-dir.js';

async function dirSize(dir) {
    let total = 0;
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isDirectory()) total += await dirSize(p);
            else { try { total += (await stat(p)).size; } catch { /* skip */ } }
        }
    } catch { /* dir missing */ }
    return total;
}

// Read at call time (not module load) so tests can point DATA_DIR at a temp dir.
function guidesRoot() {
    try { return featureDir('guides'); } catch { return null; }
}

// ── State ─────────────────────────────────────────────────────────────────────

const _jobs       = [];          // all jobs, any status
const _clients    = new Set();   // active SSE response objects

// ── SSE broadcast ─────────────────────────────────────────────────────────────

function broadcast(job) {
    const data = `data: ${JSON.stringify(job)}\n\n`;
    for (const res of _clients) {
        if (!res.writableEnded) res.write(data);
        else _clients.delete(res);
    }
}

export function addSseClient(res) {
    _clients.add(res);
    res.on('close', () => _clients.delete(res));
}

// ── Public queue API ──────────────────────────────────────────────────────────

export function getJobs() {
    return _jobs;
}

export function enqueueJob({ steamId, source, guideId, url, gameName }) {
    // Return existing active job rather than creating a duplicate
    const existing = _jobs.find(j =>
        j.steamId === String(steamId) &&
        j.source  === source &&
        j.guideId === guideId &&
        (j.status === 'pending' || j.status === 'running')
    );
    if (existing) return existing;

    const job = {
        id:          randomUUID(),
        steamId:     String(steamId),
        source,
        guideId,
        url,
        gameName:    gameName ?? '',
        status:      'pending',
        progress:    { download: 0, pages: 0, subtask: 0 },
        log:         [],
        createdAt:   new Date().toISOString(),
        startedAt:   null,
        completedAt: null,
        error:       null,
        sizeBytes:   null,
    };

    _jobs.push(job);
    broadcast(job);
    _schedule();
    return job;
}

export function cancelJob(jobId) {
    const job = _jobs.find(j => j.id === jobId);
    if (!job || job.status !== 'pending') return false;
    _patch(job, { status: 'cancelled', completedAt: new Date().toISOString() });
    return true;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function _schedule() {
    const running = new Set(_jobs.filter(j => j.status === 'running').map(j => j.source));
    const next    = _jobs.find(j => j.status === 'pending' && !running.has(j.source));
    if (next) _runJob(next);
}

// ── Worker ────────────────────────────────────────────────────────────────────

function _patch(job, fields) {
    Object.assign(job, fields);
    broadcast(job);
}

function _runScript(job, scriptName, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [join(TOOLS_DIR, scriptName), ...args],
            { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
        );

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        let buf = '';
        let sawDownloadProgress = false;

        const flush = (chunk) => {
            buf += chunk;
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.trim()) continue;

                // Tolerate a [PROGRESS] marker that lands mid-line: fetchers print partial
                // status lines with no trailing newline, so an emit can be appended to one.
                const pi = line.indexOf('[PROGRESS] ');
                if (pi !== -1) {
                    try {
                        const { bar, pct } = JSON.parse(line.slice(pi + 11));
                        if (bar === 'pages')    _patch(job, { progress: { ...job.progress, pages:    pct } });
                        if (bar === 'subtask')  _patch(job, { progress: { ...job.progress, subtask:  pct } });
                        // A fetcher that reports its own download progress opts out of the
                        // [n/N] stdout scraping below — its page total isn't known up front.
                        if (bar === 'download') { sawDownloadProgress = true; _patch(job, { progress: { ...job.progress, download: pct } }); }
                    } catch { /* malformed */ }
                } else {
                    // Fetch progress: [n/N] in the line. Legacy fallback for fetchers that
                    // walk a page set of known size and never emit [PROGRESS] download.
                    const m = sawDownloadProgress ? null : line.match(/\[(\d+)\/(\d+)\]/);
                    if (m) {
                        const pct = Math.round(parseInt(m[1]) / parseInt(m[2]) * 100);
                        job.progress = { ...job.progress, download: pct };
                    }
                    // Keep a rolling log of the last 100 lines
                    job.log.push(line);
                    if (job.log.length > 100) job.log.shift();
                    broadcast(job);
                }
            }
        };

        child.stdout.on('data', flush);
        child.stderr.on('data', flush);

        child.on('close', code => {
            if (buf.trim()) { job.log.push(buf); broadcast(job); }
            if (code === 0) resolve();
            else reject(new Error(`${scriptName} exited with code ${code}`));
        });

        child.on('error', reject);
    });
}

async function _runJob(job) {
    _patch(job, { status: 'running', startedAt: new Date().toISOString() });

    try {
        await _runScript(job, 'fetch-guide.js', [
            '--url',      job.url,
            '--steam-id', job.steamId,
            '--source',   job.source,
            '--guide-id', job.guideId,
        ]);

        _patch(job, { progress: { ...job.progress, download: 100 } });

        await _runScript(job, 'parse-guide.js', [
            '--steam-id', job.steamId,
            '--source',   job.source,
            '--guide-id', job.guideId,
        ]);

        let sizeBytes = null;
        const root = guidesRoot();
        if (root) {
            sizeBytes = await dirSize(join(root, job.steamId, job.source, job.guideId));
        }

        _patch(job, {
            status:      'done',
            completedAt: new Date().toISOString(),
            progress:    { download: 100, pages: 100, subtask: 100 },
            sizeBytes,
        });
    } catch (err) {
        _patch(job, {
            status:      'error',
            completedAt: new Date().toISOString(),
            error:       err.message,
        });
    } finally {
        _schedule();
    }
}
