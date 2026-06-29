import { test, expect } from '@playwright/test'

// Wait for the Svelte layout to finish mounting (sidebar is rendered client-side)
async function waitForLayout(page) {
    await page.waitForSelector('.sidebar-nav-btn', { timeout: 10_000 })
}

// ── Shell structure ───────────────────────────────────────────────────────────

test('layout shell renders all required elements', async ({ page }) => {
    await page.goto('/')
    await waitForLayout(page)
    // Toggle button is CSS-hidden on desktop (mobile-only control) — check it's in DOM
    await expect(page.locator('#sidebar-toggle')).toBeAttached()
    await expect(page.locator('#sidebar-overlay')).toBeAttached()
    await expect(page.locator('#sidebar')).toBeVisible()
    await expect(page.locator('#main-content')).toBeVisible()
})

test('sidebar renders all nav buttons', async ({ page }) => {
    await page.goto('/')
    await waitForLayout(page)
    const buttons = [
        '.sidebar-home-btn', '.sidebar-library-btn', '.sidebar-wishlist-btn',
        '.sidebar-discover-btn', '.sidebar-alerts-btn', '.sidebar-calendar-btn',
        '.sidebar-top-games-btn', '.sidebar-history-btn',
        '.sidebar-inprogress-btn', '.sidebar-backlog-btn', '.sidebar-favorites-btn',
        '.sidebar-abandoned-btn', '.sidebar-hof-btn', '.sidebar-franchises-btn',
        '.sidebar-myreviews-btn', '.sidebar-account-btn', '.sidebar-settings-btn',
    ]
    for (const sel of buttons) {
        await expect(page.locator(sel)).toBeVisible()
    }
})

// ── Sidebar active state (derived from URL) ───────────────────────────────────

const ACTIVE_CASES = [
    ['/',             '.sidebar-home-btn'],
    ['/library',      '.sidebar-library-btn'],
    ['/wishlist',     '.sidebar-wishlist-btn'],
    ['/discover',     '.sidebar-discover-btn'],
    ['/alerts',       '.sidebar-alerts-btn'],
    ['/calendar',     '.sidebar-calendar-btn'],
    ['/history',      '.sidebar-history-btn'],
    ['/in-progress',  '.sidebar-inprogress-btn'],
    ['/backlog',      '.sidebar-backlog-btn'],
    ['/favorites',    '.sidebar-favorites-btn'],
    ['/abandoned',    '.sidebar-abandoned-btn'],
    ['/hall-of-fame', '.sidebar-hof-btn'],
    ['/franchises',   '.sidebar-franchises-btn'],
    ['/my-reviews',   '.sidebar-myreviews-btn'],
    ['/account',      '.sidebar-account-btn'],
    ['/settings',     '.sidebar-settings-btn'],
]

// /releases shares the calendar button (both activate .sidebar-calendar-btn)
test('active: .sidebar-calendar-btn on /releases (releases shares calendar button)', async ({ page }) => {
    await page.goto('/releases')
    await waitForLayout(page)
    await expect(page.locator('.sidebar-calendar-btn')).toHaveClass(/\bactive\b/)
})

for (const [url, selector] of ACTIVE_CASES) {
    test(`active: ${selector} on ${url}`, async ({ page }) => {
        await page.goto(url)
        await waitForLayout(page)
        await expect(page.locator(selector)).toHaveClass(/\bactive\b/)
        // All other top-level buttons should NOT be active
        const others = ACTIVE_CASES.filter(([u]) => u !== url).map(([, s]) => s)
        for (const other of others) {
            await expect(page.locator(other)).not.toHaveClass(/\bactive\b/)
        }
    })
}

test('active: .sidebar-library-btn on /game/730 (game highlights library)', async ({ page }) => {
    await page.goto('/game/730')
    await waitForLayout(page)
    await expect(page.locator('.sidebar-library-btn')).toHaveClass(/\bactive\b/)
})

test('active: .sidebar-franchises-btn on /franchise/abc (franchise highlights franchises)', async ({ page }) => {
    await page.goto('/franchise/abc')
    await waitForLayout(page)
    await expect(page.locator('.sidebar-franchises-btn')).toHaveClass(/\bactive\b/)
})

test('active: no button active on /journal/730 (journal has no sidebar item)', async ({ page }) => {
    await page.goto('/journal/730')
    await waitForLayout(page)
    for (const [, selector] of ACTIVE_CASES) {
        await expect(page.locator(selector)).not.toHaveClass(/\bactive\b/)
    }
})

// ── Sidebar navigation (client-side routing, no full reloads) ─────────────────

test('clicking nav buttons performs client-side navigation', async ({ page }) => {
    await page.goto('/')
    await waitForLayout(page)

    const navCases = [
        ['.sidebar-library-btn',    '/library'],
        ['.sidebar-history-btn',    '/history'],
        ['.sidebar-backlog-btn',    '/backlog'],
        ['.sidebar-home-btn',       '/'],
    ]

    for (const [sel, expectedUrl] of navCases) {
        const requests = []
        page.on('request', r => { if (r.resourceType() === 'document') requests.push(r.url()) })
        await page.click(sel)
        await expect(page).toHaveURL(expectedUrl)
        // No full-page document request — it's a client-side navigation
        expect(requests.filter(u => u.includes(expectedUrl))).toHaveLength(0)
    }
})

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────

test.describe('mobile sidebar', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('toggle button opens sidebar and overlay', async ({ page }) => {
        await page.goto('/')
        await waitForLayout(page)
        await expect(page.locator('#sidebar')).not.toHaveClass(/sidebar--open/)
        await expect(page.locator('#sidebar-overlay')).not.toHaveClass(/visible/)
        await page.click('#sidebar-toggle')
        await expect(page.locator('#sidebar')).toHaveClass(/sidebar--open/)
        await expect(page.locator('#sidebar-overlay')).toHaveClass(/visible/)
    })

    test('overlay click closes sidebar', async ({ page }) => {
        await page.goto('/')
        await waitForLayout(page)
        await page.click('#sidebar-toggle')
        await expect(page.locator('#sidebar')).toHaveClass(/sidebar--open/)
        // Click the overlay at the right edge — outside the open sidebar panel
        await page.click('#sidebar-overlay', { position: { x: 360, y: 400 } })
        await expect(page.locator('#sidebar')).not.toHaveClass(/sidebar--open/)
        await expect(page.locator('#sidebar-overlay')).not.toHaveClass(/visible/)
    })

    test('sidebar closes automatically after navigation', async ({ page }) => {
        await page.goto('/')
        await waitForLayout(page)
        await page.click('#sidebar-toggle')
        await expect(page.locator('#sidebar')).toHaveClass(/sidebar--open/)
        await page.click('.sidebar-library-btn')
        await expect(page).toHaveURL('/library')
        await expect(page.locator('#sidebar')).not.toHaveClass(/sidebar--open/)
    })
})

// ── gj_game_from tracking ─────────────────────────────────────────────────────

test('beforeNavigate sets gj_game_from when navigating to a game', async ({ page }) => {
    await page.goto('/library')
    await waitForLayout(page)

    // Trigger a client-side navigation to a game via keyboard on the URL bar
    // Use page.evaluate to call SvelteKit's goto (exposed via import in the bundle)
    await page.evaluate(() => {
        // SvelteKit exposes navigation via __sveltekit_app in some versions;
        // simplest reliable approach: find the goto module via the live bundle
        return import('/@id/__x00__virtual:sveltekit/client/app.js')
            .then(m => m.goto('/game/730'))
            .catch(() => {
                // Fallback: use a link click to trigger client navigation
                const a = document.createElement('a')
                a.href = '/game/730'
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
            })
    })
    await expect(page).toHaveURL('/game/730')
    const from = await page.evaluate(() => sessionStorage.getItem('gj_game_from'))
    expect(from).toBe('library')
})

// ── Route coverage ────────────────────────────────────────────────────────────

const ALL_ROUTES = [
    '/', '/toc', '/library', '/wishlist', '/account',
    '/calendar', '/releases', '/top-games', '/alerts',
    '/favorites', '/backlog', '/abandoned', '/history',
    '/in-progress', '/hall-of-fame', '/settings',
    '/franchises', '/my-reviews', '/discover',
    '/game/730', '/franchise/123',
    '/journal/730', '/journal/730/notes',
    '/community/730',
]

for (const route of ALL_ROUTES) {
    test(`route ${route}: returns 200 and mounts layout`, async ({ page }) => {
        const response = await page.goto(route)
        expect(response?.status()).toBe(200)
        await waitForLayout(page)
        await expect(page.locator('#main-content')).toBeVisible()
    })
}

// ── Optional journal sub-param ────────────────────────────────────────────────

test('journal route renders same component with and without sub param', async ({ page }) => {
    await page.goto('/journal/730')
    await waitForLayout(page)
    const withoutSub = await page.locator('#main-content').innerHTML()

    await page.goto('/journal/730/notes')
    await waitForLayout(page)
    const withSub = await page.locator('#main-content').innerHTML()

    // Both should render something (not empty), confirming the [[sub]] param works
    expect(withoutSub.trim()).not.toBe('')
    expect(withSub.trim()).not.toBe('')
})
