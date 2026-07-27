// Guide scraper configuration.
// Pass overrides via CLI flags; these are the defaults.
export const defaults = {
    links: {
        // false = strip <a> tags to external sites, leaving their text content
        keepExternal: false,
        // true = rewrite internal guide section links to relative paths
        keepInternal: true,
    },
    br: {
        // 'strip' removes <br> entirely
        // 'keep'  leaves <br> as-is
        behavior: 'keep',
    },
    fetch: {
        // Random delay between page fetches: minMs + random(0, maxMs-minMs)
        delayMinMs: 1500,
        delayMaxMs: 3800,
        viewportWidth: 1366,
        viewportHeight: 768,
        timeout: 30_000,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
    // Interactive-map downloads (IGN /maps → Map Genie tiles).
    //
    // A full pyramid is tens of thousands of tiles, so unlike a page crawl it
    // cannot be paced at seconds-per-request. These settings hold the sustained
    // rate to roughly what a person panning the live map produces — a modest
    // number of connections, each pausing between requests — rather than
    // saturating the CDN. concurrency x (delay + latency) is the throttle:
    // 6 workers at ~120-320ms lands near 20 req/s.
    map: {
        tileConcurrency: 6,
        tileDelayMinMs:  120,
        tileDelayMaxMs:  320,
        // Retries are for 5xx/429/network only — an absent tile answers 403
        // (S3 without ListBucket) and is never retried.
        tileRetries:     3,
        // Backoff base for retries; doubles per attempt. A 429/503 carrying
        // Retry-After overrides it.
        retryBackoffMs:  800,
        // Between map pages when a game has several maps.
        pageDelayMinMs:  1500,
        pageDelayMaxMs:  3800,
    },
};

export function applyCliOverrides(cfg, argv) {
    if (argv.includes('--keep-external-links')) cfg.links.keepExternal = true;
    if (argv.includes('--strip-internal-links')) cfg.links.keepInternal = false;
    if (argv.includes('--keep-br')) cfg.br.behavior = 'keep';
    if (argv.includes('--strip-br')) cfg.br.behavior = 'strip';
    return cfg;
}
