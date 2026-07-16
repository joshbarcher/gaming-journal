// Worker bootstrap (not in the relay). worker_threads bypass vite, so node
// loads the worker's import chain raw from src/. That chain is vite-flavored
// ESM: relay-ported .js services import '../../logger.js', which on disk is
// logger.ts (vite resolves .js specifiers to .ts siblings; plain node does
// not). Register a resolve fallback that retries a failed relative './x.js'
// as './x.ts' — node ≥ 23.6 then loads the .ts natively via type stripping
// (the prod box and dev machines both run node 24). registerHooks() is the
// sync hooks API, in-thread, so it only affects this worker.
import { registerHooks } from 'node:module';

registerHooks({
    resolve(specifier, context, nextResolve) {
        try {
            return nextResolve(specifier, context);
        } catch (err) {
            if (specifier.startsWith('.') && specifier.endsWith('.js')) {
                try { return nextResolve(`${specifier.slice(0, -3)}.ts`, context); }
                catch { throw err; } // report the original .js failure
            }
            throw err;
        }
    },
});

// Dynamic import so the hook is registered before the worker's chain resolves.
await import('./discovery.worker.js');
