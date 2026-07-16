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
};

export function applyCliOverrides(cfg, argv) {
    if (argv.includes('--keep-external-links')) cfg.links.keepExternal = true;
    if (argv.includes('--strip-internal-links')) cfg.links.keepInternal = false;
    if (argv.includes('--keep-br')) cfg.br.behavior = 'keep';
    if (argv.includes('--strip-br')) cfg.br.behavior = 'strip';
    return cfg;
}
