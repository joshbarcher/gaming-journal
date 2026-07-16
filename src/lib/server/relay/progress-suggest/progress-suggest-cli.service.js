// Ported verbatim from relay-server src/services/progress-suggest/progress-suggest-cli.service.js (docs/relay-fold-in.md §6 — byte-identical logic).
import { spawn }                          from 'node:child_process';
import { createInterface }                from 'node:readline';
import { writeFile, mkdir }               from 'node:fs/promises';
import { join, dirname, delimiter }        from 'node:path';
import { buildPrompt, parseTrackers }      from './progress-suggest.service.js';
import { getEstimatedMs, recordCompletion } from './tracker-timings.store.js';
import logger                              from '../../logger.js';

const FAILED_DIR    = join(process.cwd(), 'data', 'failed-responses');
const TIMEOUT_MS    = 15 * 60 * 1000;      // legit runs can hit ~7 min; give headroom
const TICK_INTERVAL = 3_000;
// Pinned so dev and prod run the SAME model instead of each machine's default
// (which drifted to opus-4-8 locally / sonnet-5 on the NUC). See progress-suggest.md.
const MODEL         = 'claude-opus-4-8';

async function saveFailedResponse(gameName, streamLog, stderr) {
    try {
        await mkdir(FAILED_DIR, { recursive: true });
        const ts   = new Date().toISOString().replace(/[:.]/g, '-');
        const safe = gameName.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
        const path = join(FAILED_DIR, `${ts}-${safe}.txt`);
        const body = [
            `GAME: ${gameName}`,
            `DATE: ${new Date().toISOString()}`,
            `MODEL: ${MODEL}`,
            '',
            '=== STREAM (stdout, NDJSON) ===',
            streamLog || '(empty)',
            '',
            '=== STDERR ===',
            stderr || '(empty)',
        ].join('\n');
        await writeFile(path, body, 'utf8');
        logger.warn('[progress-suggest] failure saved', { path });
        return path;
    } catch (e) {
        logger.error('[progress-suggest] could not save failed response', { err: e.message });
        return null;
    }
}

// Time-based progress floor: 0–90% over the estimate, then creep so a long run
// never freezes the bar. Real tool activity (below) can push it higher/faster.
function timeProgress(elapsedMs, estimatedMs) {
    if (elapsedMs < estimatedMs) return Math.max(1, Math.round((elapsedMs / estimatedMs) * 90));
    return Math.min(95, 90 + Math.floor((elapsedMs - estimatedMs) / 20_000));
}

const KNOWN_TYPES = ['progress', 'progress-bars', 'counter', 'multi-counter'];

// Structural check of what parseTrackers returned, so schema drift is logged
// explicitly instead of silently producing broken trackers.
function validateTrackers(trackers) {
    const issues = [];
    trackers.forEach((t, i) => {
        const tag = `#${i} "${t?.title ?? '?'}"`;
        if (!t || typeof t !== 'object') { issues.push(`${tag}: not an object`); return; }
        if (!t.title)                       issues.push(`${tag}: missing title`);
        if (!KNOWN_TYPES.includes(t.type))  issues.push(`${tag}: bad type "${t.type}"`);
        if (t.type === 'progress'       && !Array.isArray(t.tasks))    issues.push(`${tag}: progress missing tasks[]`);
        if (t.type === 'progress-bars'  && !Array.isArray(t.bars))     issues.push(`${tag}: progress-bars missing bars[]`);
        if (t.type === 'counter'        && typeof t.target !== 'number') issues.push(`${tag}: counter missing numeric target`);
        if (t.type === 'multi-counter'  && !Array.isArray(t.counters)) issues.push(`${tag}: multi-counter missing counters[]`);
    });
    return issues;
}

export async function suggestTrackersViaCli(gameName, onEvent = () => {}) {
    const estimatedMs = await getEstimatedMs();
    const startedAt   = Date.now();

    // Every log line is both persisted server-side AND pushed to the client.
    const emitLog = (line) => {
        logger.info(`[progress-suggest] ${line}`, { gameName });
        onEvent({ type: 'log', line });
    };

    emitLog(`Starting "${gameName}" — model ${MODEL}, est ~${Math.round(estimatedMs / 1000)}s`);
    onEvent({ type: 'start', gameName });

    // Strip ANTHROPIC_API_KEY so the CLI bills against the OAuth subscription.
    const { ANTHROPIC_API_KEY: _stripped, ...childEnv } = process.env;
    // pm2 gives the relay a minimal PATH without the nvm/npm-global bin dir where
    // `claude` lives; the global CLI sits next to the running node binary.
    const nodeBinDir = dirname(process.execPath);
    const childPath  = `${nodeBinDir}${delimiter}${childEnv.PATH ?? ''}`;

    const proc = spawn('claude', [
        '-p',
        '--model',         MODEL,
        '--output-format', 'stream-json',
        '--verbose',
        '--allowedTools',  'WebSearch,WebFetch',
    ], {
        env:   { ...childEnv, PATH: childPath, NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true, // required on Windows: npm global installs are .cmd wrappers
    });

    proc.stdin.write(buildPrompt(gameName));
    proc.stdin.end();

    // ── Live stream state ──────────────────────────────────────────────────────
    let toolCalls  = 0;
    let resultText = null;
    let resultSeen = false;
    let isError    = false;
    let errText    = null;
    let stderr     = '';
    const rawLines = [];

    const handleEvent = (ev) => {
        switch (ev.type) {
            case 'system':
                if (ev.subtype === 'init') emitLog(`Session ${String(ev.session_id).slice(0, 8)} · model ${ev.model}`);
                break;

            case 'assistant':
                for (const block of ev.message?.content ?? []) {
                    if (block.type === 'tool_use') {
                        if (block.name === 'WebSearch') { toolCalls++; emitLog(`🔎 Search: ${block.input?.query ?? ''}`); onEvent({ type: 'searching', query: block.input?.query ?? '' }); }
                        else if (block.name === 'WebFetch') { toolCalls++; emitLog(`📄 Fetch: ${block.input?.url ?? ''}`); }
                        else if (block.name === 'ToolSearch') { /* internal tool-loading noise — skip */ }
                        else { toolCalls++; emitLog(`🔧 ${block.name}`); }
                    } else if (block.type === 'text' && block.text?.trim()) {
                        emitLog('✍️  Writing trackers…');
                        onEvent({ type: 'writing' });
                    }
                }
                break;

            case 'user':
                for (const block of ev.message?.content ?? []) {
                    if (block.type !== 'tool_result') continue;
                    const r = ev.tool_use_result;
                    if (Array.isArray(r?.results))      emitLog(`   ↳ ${r.results.length} search result(s)`);
                    else if (typeof r?.bytes === 'number') emitLog(`   ↳ fetched ${Math.round(r.bytes / 1024)} KB`);
                }
                break;

            case 'result':
                resultSeen = true;
                isError    = !!ev.is_error;
                resultText = ev.result ?? null;
                if (isError) { errText = ev.result || ev.subtype || 'unknown error'; emitLog(`❌ CLI error: ${errText}`); }
                else emitLog(`✅ CLI finished — ${ev.num_turns} turns, ${Math.round((ev.duration_ms ?? 0) / 1000)}s, ${toolCalls} tool call(s)`);
                break;
        }
    };

    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
        rawLines.push(line);
        let ev;
        try { ev = JSON.parse(line); } catch { return; } // non-JSON noise — keep in rawLines only
        try { handleEvent(ev); } catch (e) { logger.warn('[progress-suggest] event handler threw', { err: e.message }); }
    });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });

    // Blended progress: max of time-floor and real activity, capped until the
    // result arrives — so the bar reflects work and never sits dead.
    const ticker = setInterval(() => {
        const timePct = timeProgress(Date.now() - startedAt, estimatedMs);
        const actPct  = Math.min(88, 8 + toolCalls * 6);
        let pct = Math.max(timePct, actPct);
        if (!resultSeen) pct = Math.min(pct, 90);
        onEvent({ type: 'tick', progress: pct });
    }, TICK_INTERVAL);

    return new Promise((resolve, reject) => {
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            proc.kill();
            clearInterval(ticker);
            emitLog('⏱️  Timed out after 15 minutes — killing process');
            reject(new Error('Progress suggest (CLI): timed out after 15 minutes'));
        }, TIMEOUT_MS);

        proc.on('close', async (code) => {
            clearInterval(ticker);
            clearTimeout(timeout);
            if (timedOut) return;

            if (code !== 0 || isError) {
                const path = await saveFailedResponse(gameName, rawLines.join('\n'), stderr);
                logger.error('[progress-suggest] process failed', { code, isError, errText, stderr: stderr.slice(0, 500), savedTo: path });
                return reject(new Error(errText || `claude exited ${code} — see ${path ?? FAILED_DIR}`));
            }

            try {
                emitLog('Parsing tracker JSON…');
                const trackers = parseTrackers(resultText ?? '');
                const issues   = validateTrackers(trackers);
                if (issues.length) {
                    emitLog(`⚠️  Schema issues (${issues.length}): ${issues.slice(0, 3).join(' | ')}${issues.length > 3 ? ' …' : ''}`);
                    logger.warn('[progress-suggest] schema issues', { gameName, issues });
                } else {
                    emitLog(`Schema OK — ${trackers.length} trackers`);
                }
                const durationMs = Date.now() - startedAt;
                await recordCompletion(durationMs);
                emitLog(`Done — ${trackers.length} trackers in ${Math.round(durationMs / 1000)}s`);
                resolve(trackers);
            } catch (err) {
                const path = await saveFailedResponse(gameName, rawLines.join('\n'), stderr);
                emitLog(`❌ Parse failed: ${err.message}`);
                logger.error('[progress-suggest] parse failed', { err: err.message, savedTo: path });
                reject(new Error(`${err.message} — see ${path ?? FAILED_DIR}`));
            }
        });

        proc.on('error', (err) => {
            clearInterval(ticker);
            clearTimeout(timeout);
            emitLog(`❌ Spawn error: ${err.message}`);
            logger.error('[progress-suggest] spawn error', { err: err.message });
            reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
        });
    });
}
