import logger from '../../logger.js';
import { rateLimitSleep } from './rate-limit.js';

const MAX_RETRIES = 3;

// HTTP status codes that are worth retrying
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Fetch a Steam API URL with automatic retry.
 *
 * 429: reads the Retry-After response header (seconds) and waits exactly
 *      that long before retrying. If the header is absent, waits 60 s.
 * 5xx: exponential backoff — 1 s, 2 s, 4 s — then gives up.
 * Other non-ok: throws immediately (bad key, bad steamid, etc.)
 */
export async function steamFetch(url) {
    let attempt = 0;

    while (true) {
        const res = await fetch(url);

        if (res.ok) return res;

        if (!RETRYABLE.has(res.status) || attempt >= MAX_RETRIES) {
            throw new Error(`Steam API ${res.status} ${res.statusText} — ${url}`);
        }

        let waitMs;

        if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After');
            // Retry-After is in whole seconds per RFC 7231
            waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
            logger.warn('[steam-fetch] Rate limited — waiting for Retry-After', { waitMs, attempt });
        } else {
            // Exponential backoff for transient server errors: 1 s, 2 s, 4 s
            waitMs = Math.pow(2, attempt) * 1_000;
            logger.warn(`[steam-fetch] ${res.status} error — retrying`, { waitMs, attempt });
        }

        attempt++;
        // Not rateLimitSleep: this backoff is part of the retry contract and the
        // tests observe it by stubbing setTimeout (they never really sleep).
        await new Promise((r) => setTimeout(r, waitMs));
    }
}

/**
 * Process a list of items one at a time, enforcing a maximum request rate.
 *
 * Each handler call is expected to make exactly one Steam API request.
 * The rate limiter measures actual elapsed time per item and waits only
 * the remaining slice of the interval — so a slow network call naturally
 * consumes its own slot without adding unnecessary extra delay.
 *
 * @param {Array}    items           - Items to process.
 * @param {Function} handler         - async (item, index, total) => boolean
 *                                     Return true if a network request was made, false/void to skip the rate-limit delay.
 * @param {object}   [opts]
 * @param {number}   [opts.requestsPerSecond=1] - Hard ceiling on request rate.
 * @param {number}   [opts.jitterMs=0]          - Max random extra delay added to each interval.
 * @param {Function} [opts.onProgress]          - Called after each item: (done, total).
 */
export async function processBatch(items, handler, { requestsPerSecond = 1, jitterMs = 0, onProgress } = {}) {
    if (items.length === 0) return;

    const intervalMs = 1_000 / requestsPerSecond;

    for (let i = 0; i < items.length; i++) {
        const start      = Date.now();
        const didFetch   = await handler(items[i], i, items.length);

        if (onProgress) onProgress(i + 1, items.length);

        if (didFetch && i < items.length - 1) {
            const elapsed   = Date.now() - start;
            const jitter    = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
            const remaining = Math.max(0, intervalMs + jitter - elapsed);
            await rateLimitSleep(remaining);
        }
    }
}
