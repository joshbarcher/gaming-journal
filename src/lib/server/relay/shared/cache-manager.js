import logger from '../../logger.js';

// Registry of named caches: name → async buildFn
const _registry = new Map();

export function register(name, buildFn) {
    _registry.set(name, buildFn);
}

// Rebuild one or more named caches in parallel.
// Logs errors without throwing so a failed rebuild never crashes a sync.
export async function rebuild(...names) {
    const targets = names.length ? names : [..._registry.keys()];
    await Promise.all(
        targets.map((name) => {
            const fn = _registry.get(name);
            if (!fn) { logger.warn(`[cache] Unknown cache: ${name}`); return; }
            return fn().catch((err) => logger.error(`[cache] Rebuild failed: ${name}`, { err: err.message }));
        })
    );
}
