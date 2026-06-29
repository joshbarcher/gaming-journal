import { test, expect } from '@playwright/test'

async function waitForLayout(page) {
    await page.waitForSelector('.sidebar-nav-btn', { timeout: 10_000 })
}

// ── 1. No SharedWorker errors in console ─────────────────────────────────────

test('no SharedWorker console errors on page load', async ({ page }) => {
    const errors = []
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', err => errors.push(err.message))

    await page.goto('/')
    await waitForLayout(page)

    const workerErrors = errors.filter(e =>
        e.toLowerCase().includes('sharedworker') ||
        e.toLowerCase().includes('relay-events.worker') ||
        e.toLowerCase().includes('[guide-jobs]') ||
        e.toLowerCase().includes('[tracker-jobs]') ||
        e.toLowerCase().includes('[sidebar-poll]')
    )
    expect(workerErrors, `SharedWorker errors: ${workerErrors.join(', ')}`).toHaveLength(0)
})

// ── 2. Sidebar data loads from SSR (no client-side mount fetches for counts) ──

test('sidebar counts present immediately — no spinner state', async ({ page }) => {
    // Intercept the client-side flag/account/franchise fetches; if SSR works,
    // these should never be called for initial render.
    const clientFetches = []
    page.on('request', req => {
        const url = req.url()
        if (url.includes('/api/flags') || url.includes('/api/franchises')) {
            clientFetches.push(url)
        }
    })

    await page.goto('/')
    await waitForLayout(page)

    // Give a moment for any pending mount fetches to fire
    await page.waitForTimeout(500)

    expect(clientFetches, `Client-side flag/franchise fetches fired: ${clientFetches.join(', ')}`).toHaveLength(0)
})

test('sidebar renders library badge (count > 0) from SSR data', async ({ page }) => {
    await page.goto('/')
    await waitForLayout(page)
    // Library badge should be visible if account has games; at minimum the nav item exists
    const navBtn = page.locator('.sidebar-library-btn')
    await expect(navBtn).toBeVisible()
    // Badge text should be a positive number if the library has games
    const badge = page.locator('.sidebar-library-btn .sidebar-collection-badge')
    const count = await badge.count()
    if (count > 0) {
        const text = await badge.textContent()
        expect(Number(text)).toBeGreaterThan(0)
    }
})

// ── 3. /api/pages NOT fetched client-side (comes from SSR) ───────────────────

test('sidebar pages data arrives from SSR — no client /api/pages fetch', async ({ page }) => {
    const pagesFetches = []
    page.on('request', req => {
        if (req.url().includes('/api/pages')) pagesFetches.push(req.url())
    })

    await page.goto('/')
    await waitForLayout(page)
    await page.waitForTimeout(500)

    expect(pagesFetches).toHaveLength(0)
})

// ── 4. No relay-events.worker.js request ─────────────────────────────────────

test('relay-events.worker.js is never requested', async ({ page }) => {
    const workerReqs = []
    page.on('request', req => {
        if (req.url().includes('relay-events.worker')) workerReqs.push(req.url())
    })

    await page.goto('/')
    await waitForLayout(page)
    await page.goto('/downloads')
    await waitForLayout(page)
    await page.waitForTimeout(500)

    expect(workerReqs, `Worker JS was requested: ${workerReqs.join(', ')}`).toHaveLength(0)
})

// ── 5. DownloadsPage opens EventSource on visit ───────────────────────────────

test('DownloadsPage opens EventSource streams on visit', async ({ page }) => {
    const sseReqs = []
    page.on('request', req => {
        if (req.url().includes('/jobs/stream')) sseReqs.push(req.url())
    })

    await page.goto('/downloads')
    await waitForLayout(page)
    await page.waitForTimeout(1000)

    const guideStream   = sseReqs.some(u => u.includes('guides/jobs/stream'))
    const trackerStream = sseReqs.some(u => u.includes('progress-suggest/jobs/stream'))

    expect(guideStream,   'Guide jobs SSE stream was not opened').toBe(true)
    expect(trackerStream, 'Tracker jobs SSE stream was not opened').toBe(true)
})

// ── 6. DownloadsPage closes EventSource when tab hidden ───────────────────────

test('DownloadsPage EventSource closes on visibilitychange:hidden', async ({ page }) => {
    const openedStreams  = []
    const closedStreams  = []

    page.on('request',  req  => { if (req.url().includes('/jobs/stream')) openedStreams.push(req.url()) })
    page.on('response', resp => { if (resp.url().includes('/jobs/stream')) closedStreams.push(resp.url()) })

    await page.goto('/downloads')
    await waitForLayout(page)
    await page.waitForTimeout(500)

    expect(openedStreams.length, 'Streams should have opened').toBeGreaterThanOrEqual(2)

    // Simulate tab going hidden — EventSource should close
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(300)

    // Simulate tab becoming visible again — streams should reopen
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(500)

    // After coming back visible, new SSE connections should have been opened
    expect(openedStreams.length, 'Streams should reopen after becoming visible').toBeGreaterThanOrEqual(4)
})

// ── 7. Navigating away from DownloadsPage does not leave SSE open ─────────────

test('EventSource does not remain open after leaving DownloadsPage', async ({ page }) => {
    const activeStreams = new Set()
    page.on('request',  req  => { if (req.url().includes('/jobs/stream')) activeStreams.add(req.url()) })
    page.on('requestfailed', req => { activeStreams.delete(req.url()) })

    await page.goto('/downloads')
    await waitForLayout(page)
    await page.waitForTimeout(500)
    expect(activeStreams.size).toBeGreaterThan(0)

    // Navigate away
    await page.goto('/')
    await waitForLayout(page)
    await page.waitForTimeout(500)

    // No streaming requests should be pending on the home page
    const pending = []
    page.on('request', req => {
        if (req.url().includes('/jobs/stream')) pending.push(req.url())
    })
    await page.waitForTimeout(500)
    expect(pending).toHaveLength(0)
})

// ── 8. BroadcastChannel polling: only 2 relay requests per poll cycle ────────

test('sidebar poll: at most 2 relay requests in the first poll window', async ({ page }) => {
    const pollReqs = []
    page.on('request', req => {
        const url = req.url()
        if (url.includes('/relay/api/steam/now-playing') || url.includes('/relay/api/pin')) {
            pollReqs.push(url)
        }
    })

    // Clear any existing poll timestamp so the first maybePoll actually fires
    await page.addInitScript(() => {
        localStorage.removeItem('sidebar_last_poll')
    })

    await page.goto('/')
    await waitForLayout(page)
    await page.waitForTimeout(1500)

    // Should have at most 2 relay calls (one now-playing + one pin)
    expect(pollReqs.length).toBeLessThanOrEqual(2)
    expect(pollReqs.some(u => u.includes('now-playing')), 'now-playing should be polled').toBe(true)
    expect(pollReqs.some(u => u.includes('/relay/api/pin')), 'pin should be polled').toBe(true)
})

// ── 9. GuidesModal fetches jobs once on open ─────────────────────────────────

test('GuidesModal triggers a guide jobs fetch on open', async ({ page }) => {
    const jobsFetches = []
    page.on('request', req => {
        if (req.url().includes('/relay/api/guides/jobs') && !req.url().includes('/stream')) {
            jobsFetches.push(req.url())
        }
    })

    // GuidesModal opens via the "Find" button on the journal dashboard
    await page.goto('/journal/730')
    await waitForLayout(page)

    const findBtn = page.locator('.gj-find-guides-btn')
    await expect(findBtn).toBeVisible({ timeout: 5_000 })
    await findBtn.click()
    await page.waitForTimeout(500)

    expect(jobsFetches.length, 'GuidesModal.onMount should call jobStore.fetchAll()').toBeGreaterThan(0)
})

// ── 10. Multi-tab: second tab skips poll due to BroadcastChannel timestamp ───

test('second tab skips sidebar poll if first polled recently', async ({ browser }) => {
    const ctx = await browser.newContext()

    const tab1 = await ctx.newPage()
    const tab2 = await ctx.newPage()

    const tab1PollReqs = []
    const tab2PollReqs = []

    tab1.on('request', req => {
        if (req.url().includes('now-playing') || req.url().includes('/relay/api/pin')) {
            tab1PollReqs.push(req.url())
        }
    })
    tab2.on('request', req => {
        if (req.url().includes('now-playing') || req.url().includes('/relay/api/pin')) {
            tab2PollReqs.push(req.url())
        }
    })

    // Tab1 opens with fresh timestamp cleared
    await tab1.addInitScript(() => localStorage.removeItem('sidebar_last_poll'))
    await tab1.goto('/')
    await tab1.waitForSelector('.sidebar-nav-btn', { timeout: 10_000 })
    await tab1.waitForTimeout(1500) // allow poll to fire and write timestamp

    expect(tab1PollReqs.length, 'Tab 1 should poll').toBeGreaterThan(0)

    // Tab2 opens; the localStorage timestamp is shared (same origin storage)
    // so it should skip the poll
    await tab2.goto('/')
    await tab2.waitForSelector('.sidebar-nav-btn', { timeout: 10_000 })
    await tab2.waitForTimeout(1500)

    // Tab2 should have made zero poll requests
    expect(tab2PollReqs.length, 'Tab 2 should skip poll due to recent timestamp').toBe(0)

    await ctx.close()
})
