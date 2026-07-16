/**
 * Politeness delays between outbound requests to third-party APIs (Steam, HLTB).
 *
 * These sleeps exist to protect somebody else's servers. Unit tests stub `fetch`
 * (or inject a search function), so there is no server to protect — the sleeps
 * only make the suite slow: the HLTB sync test spent 8s of its 8.4s asleep, and
 * the Steam achievements test 9.5s. Setting DISABLE_RATE_LIMIT=1 (see .env.test)
 * makes them no-ops.
 *
 * Read at call time, not import time, so a test can flip it after loading a module.
 */
export function rateLimitSleep(ms) {
    if (ms <= 0 || process.env.DISABLE_RATE_LIMIT === '1') return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
}
