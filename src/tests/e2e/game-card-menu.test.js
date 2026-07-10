import { test, expect } from '@playwright/test'

// Verifies the flag/wishlist toggle submenus added to the game-card right-click menu.
// Flag + local-wishlist APIs are intercepted so the test is deterministic and never
// mutates real data — GET returns a known state, PATCH is captured and mock-fulfilled.

async function waitForLayout(page) {
    await page.waitForSelector('.sidebar-nav-btn', { timeout: 10_000 })
}

test('game card context menu exposes flag/wishlist toggle submenus and toggles in place', async ({ page }) => {
    // Deterministic flag/wishlist state; capture the PATCH the toggle should send.
    let patchBody = null
    const flagState = { favorite: false, alert: false, backlog: false }

    await page.route('**/api/flags/*', async route => {
        const req = route.request()
        if (req.method() === 'PATCH') {
            patchBody = req.postDataJSON()
            flagState[patchBody.flag] = patchBody.value
            return route.fulfill({ json: { ...flagState } })
        }
        return route.fulfill({ json: { ...flagState } }) // GET
    })
    await page.route('**/api/local-wishlist/*', route =>
        route.fulfill({ json: { wishlisted: false } }))

    await page.goto('/library')
    await waitForLayout(page)

    const card = page.locator('[data-game-card]').first()
    await expect(card).toBeVisible({ timeout: 10_000 })

    // Right-click opens the menu (handler is on svelte:window; event bubbles from the card).
    await card.click({ button: 'right' })

    const menu = page.locator('.ctx-menu').first()
    await expect(menu).toBeVisible()

    // The three new toggle submenus sit at the top of the menu.
    for (const label of ['Play status', 'Lists & alerts', 'Visibility']) {
        await expect(menu.getByText(label, { exact: true })).toBeVisible()
    }

    // Open "Lists & alerts" (parent click also opens the submenu).
    await menu.getByText('Lists & alerts', { exact: true }).click()

    // The submenu is a second .ctx-menu level with checkable items.
    const submenu = page.locator('.ctx-menu').nth(1)
    await expect(submenu).toBeVisible()
    for (const label of ['Favorite', 'Wishlist', 'Sale Alert']) {
        await expect(submenu.getByText(label, { exact: true })).toBeVisible()
    }

    const favorite = submenu.locator('.ctx-menu-item--checkable', { hasText: 'Favorite' })
    // Starts unchecked (GET returned favorite:false).
    await expect(favorite).not.toHaveClass(/ctx-menu-item--checked/)

    // Click toggles it on.
    await favorite.click()

    // PATCH fired with the correct flag/value.
    await expect.poll(() => patchBody).toEqual({ flag: 'favorite', value: true })

    // Checkmark now shows, and the menu stayed open (so multiple toggles are possible).
    await expect(favorite).toHaveClass(/ctx-menu-item--checked/)
    await expect(submenu).toBeVisible()
    await expect(menu).toBeVisible()
})
