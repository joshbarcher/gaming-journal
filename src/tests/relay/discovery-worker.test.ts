// @ts-nocheck — exercises untyped .js relay services; runtime-verified by vitest.
// Fold-in test (no relay original): the discovery worker's spawn path changed
// during the port — the relay resolved it via import.meta.url, the journal
// resolves from process.cwd() (see discovery.service.js) because adapter-node
// relocates bundled modules into build/server/chunks. This suite proves the
// cwd-based path exists and that node can spawn + fully evaluate the worker's
// import chain (worker_threads bypass vite, so this is exactly the dev-server
// and prod resolution path). The queue is empty, so no enrichment I/O runs.
import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-discovery-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STEAM_API_KEY = 'test-key';
process.env.STEAM_ID = '76561198000000000';
process.env.ITAD_API_KEY = 'test-itad-key';
process.env.ITAD_COUNTRY = 'US';

const WORKER_PATH = path.join(process.cwd(), 'src', 'lib', 'server', 'relay', 'discovery', 'discovery.worker-boot.js');

describe('discovery worker — spawn path', () => {
    it('boot + worker files exist at the cwd-resolved path', async () => {
        await fs.access(WORKER_PATH);
        await fs.access(path.join(path.dirname(WORKER_PATH), 'discovery.worker.js'));
    });

    it('spawns and evaluates its full import chain without error', async () => {
        const worker = new Worker(WORKER_PATH, { workerData: { queue: [] } });
        try {
            await new Promise((resolve, reject) => {
                let online = false;
                // A module-resolution failure (bad relative path, $lib alias,
                // .ts import) surfaces as an 'error' event during evaluation.
                worker.once('error', reject);
                worker.once('exit', (code) => reject(new Error(`worker exited early (code ${code})`)));
                worker.once('online', () => { online = true; });
                // Import evaluation (puppeteer-extra, cheerio, sharp deps) can
                // take a few seconds — give it a grace window; if no error has
                // fired by then, the chain resolved and the idle loop is running.
                const timer = setTimeout(() => {
                    assert.equal(online, true, 'worker never came online');
                    resolve(undefined);
                }, 6000);
                timer.unref?.();
            });
        } finally {
            await worker.terminate();
        }
    }, 30_000);

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
