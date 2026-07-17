// Ported verbatim from relay-server src/services/progress-suggest/tracker-timings.store.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only the data path rewritten
// onto featureDir(), read at call time so tests can point DATA_DIR at a temp dir).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join }                        from 'node:path';
import { featureDir }                  from '../shared/data-root.js';

const DEFAULT_MS  = 4 * 60 * 1000;
const MAX_SAMPLES = 10;

function dataPath() { return join(featureDir('progress-suggest'), 'tracker-timings.json'); }

async function load() {
    try { return JSON.parse(await readFile(dataPath(), 'utf8')); }
    catch (err) {
        if (err.code === 'ENOENT') return { durations: [] };   // no file yet — empty is correct
        // Transient read/parse error: rethrow so recordCompletion() doesn't push onto an
        // empty array and overwrite real timing history with a single sample.
        throw err;
    }
}

export async function getEstimatedMs() {
    let durations;
    try { ({ durations } = await load()); }
    catch { return DEFAULT_MS; }   // transient read error — fall back to the default estimate
    if (!durations.length) return DEFAULT_MS;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}

export async function recordCompletion(durationMs) {
    let data;
    try { data = await load(); }
    catch { return; }   // transient read error — don't overwrite real history with one sample
    data.durations.push(durationMs);
    if (data.durations.length > MAX_SAMPLES) data.durations.shift();
    try {
        await mkdir(featureDir('progress-suggest'), { recursive: true });
        await writeFile(dataPath(), JSON.stringify(data));
    } catch { /* non-critical */ }
}
