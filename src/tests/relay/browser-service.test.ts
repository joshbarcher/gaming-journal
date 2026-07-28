// @ts-nocheck — exercises the untyped .js relay browser service; runtime-verified by vitest.
//
// Regression suite for the stealth-browser singleton. The bug this pins down:
// getBrowser() used `await _browser.version()` as its liveness probe, but
// puppeteer MEMOISES version() after the first successful call — so once Chrome
// died the probe kept resolving from cache (in 0ms), the singleton handed out a
// dead browser forever, and every Reddit/community fetch 500'd with
// "Connection closed." until the process was restarted.
//
// The fake browser below reproduces that trap exactly: version() always
// resolves, only `connected` tells the truth.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const launches: any[] = [];
// When set, every browser launched from here on serves this body — lets a test
// keep the bot-detection page in place across re-warm retries.
let bodyOverride: string | null = null;

function makeFakeBrowser() {
    const browser: any = {
        connected: true,
        body: bodyOverride ?? '{"ok":true}',
        // Always resolves, even once the process is dead — mirrors puppeteer's
        // memoised version(). This is the trap; connected is the truth.
        version: vi.fn(async () => 'Chrome/150.0.7871.24'),
        newPage: vi.fn(async () => {
            if (!browser.connected) {
                const err: any = new Error('Connection closed.');
                err.name = 'ConnectionClosedError';
                throw err;
            }
            return {
                goto: vi.fn(async () => {}),
                evaluate: vi.fn(async () => browser.body),
                close: vi.fn(async () => {}),
            };
        }),
        close: vi.fn(async () => { browser.connected = false; }),
        // Chrome crashing / being killed out from under us.
        die() { this.connected = false; },
    };
    return browser;
}

vi.mock('puppeteer-extra-plugin-stealth', () => ({ default: () => ({ name: 'stealth' }) }));
vi.mock('puppeteer-extra', () => ({
    default: {
        use: () => {},
        launch: vi.fn(async () => {
            const b = makeFakeBrowser();
            launches.push(b);
            return b;
        }),
    },
}));

async function loadService() {
    vi.resetModules();
    return import('../../lib/server/relay/browser/browser.service.js');
}

// The service sleeps 1.5–2.5s to warm up and 2–4s between bot-detection
// retries. Drive the mocked clock forward until the call settles so the suite
// runs instantly instead of sleeping for real.
function settle<T>(promise: Promise<T>): Promise<T> {
    let pending = true;
    const tracked = promise.then(
        (v) => { pending = false; return v; },
        (e) => { pending = false; throw e; },
    );
    tracked.catch(() => {});  // the caller asserts on it; don't warn here
    return (async () => {
        for (let i = 0; i < 500 && pending; i++) await vi.advanceTimersByTimeAsync(500);
        return tracked;
    })();
}

function setup() {
    launches.length = 0;
    bodyOverride = null;
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
}

function teardown() {
    vi.useRealTimers();
    vi.restoreAllMocks();
}

describe('relay browser.service — singleton liveness', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('reuses a live browser instead of relaunching', async () => {
        const svc = await loadService();
        const a = await settle(svc.getBrowser());
        const b = await settle(svc.getBrowser());
        expect(a).toBe(b);
        expect(launches).toHaveLength(1);
    });

    it('never hands out a dead browser, even though version() still resolves', async () => {
        const svc = await loadService();
        const first = await settle(svc.getBrowser());
        first.die();

        // The old health check called this and got a cached hit — proving the
        // probe cannot distinguish a live browser from a dead one.
        await expect(first.version()).resolves.toBe('Chrome/150.0.7871.24');

        const second = await settle(svc.getBrowser());
        expect(second).not.toBe(first);
        expect(second.connected).toBe(true);
        expect(launches).toHaveLength(2);
    });

    it('closes the old browser when relaunching so Chrome is not orphaned', async () => {
        const svc = await loadService();
        const first = await settle(svc.getBrowser());
        first.die();
        await settle(svc.getBrowser());
        expect(first.close).toHaveBeenCalled();
    });

    it('shares one launch across concurrent callers', async () => {
        const svc = await loadService();
        const [a, b, c] = await settle(
            Promise.all([svc.getBrowser(), svc.getBrowser(), svc.getBrowser()]),
        );
        expect(a).toBe(b);
        expect(b).toBe(c);
        expect(launches).toHaveLength(1);
    });
});

describe('relay browser.service — browserGet recovery', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('returns parsed JSON on the happy path', async () => {
        const svc = await loadService();
        await expect(settle(svc.browserGet('https://example.test/x.json'))).resolves.toEqual({ ok: true });
    });

    it('relaunches and retries when Chrome dies mid-fetch instead of surfacing a 500', async () => {
        const svc = await loadService();
        const first = await settle(svc.getBrowser());
        first.die();  // dies between the health check and the next use

        await expect(settle(svc.browserGet('https://example.test/x.json'))).resolves.toEqual({ ok: true });
        expect(launches.length).toBeGreaterThan(1);
    });

    it('gives up with a bot-detection error when Reddit keeps serving HTML', async () => {
        // Every browser — including the re-warmed retries — serves the block page.
        bodyOverride = '<html>You have been blocked by network security.</html>';
        const svc = await loadService();
        await expect(settle(svc.browserGet('https://example.test/x.json'))).rejects.toThrow(/bot detection/);
        // 1 initial + 2 re-warm attempts before giving up.
        expect(launches).toHaveLength(3);
    });
});
