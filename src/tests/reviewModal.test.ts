import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openReviewModal, SLIDER_KEYS, BADGES } from '../lib/js/review-modal.js'
import type { LocalReview } from '../lib/types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const tick = async (n = 4) => { for (let i = 0; i < n; i++) await Promise.resolve() }

function makeReview(partial: Partial<LocalReview> = {}): LocalReview {
    return {
        stars:     0,
        ratings:   {},
        tags:      [],
        notes:     [],
        review:    '',
        badges:    {},
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...partial,
    }
}

const overlay      = () => document.querySelector('.rev-modal-overlay') as HTMLElement | null
const overlays     = () => document.querySelectorAll('.rev-modal-overlay')
const stars        = () => [...document.querySelectorAll('.rev-star')] as HTMLButtonElement[]
const activeStars  = () => stars().filter(b => b.classList.contains('rev-star--active'))
const starLabel    = () => document.querySelector('.rev-star-label')!.textContent
const saveBtn      = () => document.querySelector('.rev-save-btn') as HTMLButtonElement
const cancelBtn    = () => document.querySelector('.rev-cancel-btn') as HTMLButtonElement
const closeBtn     = () => document.querySelector('.rev-modal-close') as HTMLButtonElement
const errorText    = () => document.querySelector('.rev-footer-error')!.textContent
const textarea     = () => document.querySelector('.rev-textarea') as HTMLTextAreaElement
const customInput  = () => document.querySelector('.rev-tag-custom-input') as HTMLInputElement
const addTagBtn    = () => document.querySelector('.rev-tag-add-btn') as HTMLButtonElement
const tagButtons   = () => [...document.querySelectorAll('.rev-tag')] as HTMLButtonElement[]
const customPills  = () => tagButtons().filter(b => b.dataset.custom === '1')
const presetBtn    = (label: string) => tagButtons().find(b => !b.dataset.custom && b.textContent === label)!
const badgeCards   = () => [...document.querySelectorAll('.rev-badge-pick')] as HTMLButtonElement[]
const badgeCard    = (label: string) =>
    badgeCards().find(c => c.querySelector('.rev-badge-pick-label')!.textContent === label)!
const sliderInput  = (key: string) =>
    document.querySelector(`.rev-slider[data-key="${key}"]`) as HTMLInputElement

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

function addCustomTag(text: string) {
    customInput().value = text
    addTagBtn().click()
}

function setSlider(key: string, value: number) {
    const input = sliderInput(key)
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Extract the JSON payload of the first fetch call. */
function fetchPayload(mock: ReturnType<typeof vi.fn>) {
    const [, opts] = mock.mock.calls[0]
    return JSON.parse((opts as RequestInit).body as string)
}

function okResponse(json: unknown) {
    return { ok: true, status: 200, json: async () => json }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
    // Close any modal a test left open so its document keydown listener is
    // removed and its promise resolves — otherwise listeners leak across tests.
    while (overlay()) {
        pressEscape()
        await tick()
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

// ── Structure & star rendering rules ──────────────────────────────────────────

describe('openReviewModal — structure', () => {
    it('renders a dialog with the game name as inert text', async () => {
        const p = openReviewModal(1, 'Hades II')
        const modal = document.querySelector('.rev-modal')!
        expect(modal.getAttribute('role')).toBe('dialog')
        expect(modal.getAttribute('aria-modal')).toBe('true')
        expect(document.querySelector('.rev-modal-title')!.textContent).toBe('Hades II')
        pressEscape()
        await expect(p).resolves.toBeNull()
    })

    it('focuses the close button on open', async () => {
        const p = openReviewModal(1, 'G')
        expect(document.activeElement).toBe(closeBtn())
        pressEscape(); await p
    })

    it('renders exactly 5 regular stars plus one legendary toggle — never a 6th plain star', async () => {
        const p = openReviewModal(1, 'G')
        const all = stars()
        expect(all.length).toBe(6)
        const regular   = all.filter(b => !b.classList.contains('rev-star--legendary'))
        const legendary = all.filter(b => b.classList.contains('rev-star--legendary'))
        expect(regular.length).toBe(5)
        expect(legendary.length).toBe(1)
        expect(regular.every(b => b.textContent === '★')).toBe(true)
        expect(legendary[0].textContent).toBe('✦')
        pressEscape(); await p
    })
})

// ── XSS / injection ───────────────────────────────────────────────────────────

describe('openReviewModal — injection resistance', () => {
    it('does not parse HTML embedded in the game name', async () => {
        const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>'
        const p = openReviewModal(1, evil)
        expect(document.querySelector('.rev-modal img')).toBeNull()
        expect(document.querySelector('.rev-modal script')).toBeNull()
        expect(document.querySelector('.rev-modal-title')!.textContent).toBe(evil)
        expect((window as any).__pwned).toBeUndefined()
        pressEscape(); await p
    })

    it('does not parse HTML in a custom tag', async () => {
        const evil = '<img src=x onerror=alert(1)>'
        const p = openReviewModal(1, 'G')
        addCustomTag(evil)
        expect(document.querySelector('.rev-tags img')).toBeNull()
        expect(customPills()[0].querySelector('span')!.textContent).toBe(evil)
        pressEscape(); await p
    })

    it('does not parse HTML in existing tags or review text', async () => {
        const evil = '<svg onload=alert(1)>'
        const p = openReviewModal(1, 'G', makeReview({ tags: [evil], review: evil }))
        expect(document.querySelector('.rev-modal svg:not(.rev-badge-pick-circle svg)')).toBeNull()
        expect(textarea().value).toBe(evil)
        pressEscape(); await p
    })
})

// ── Star selection & boundaries ───────────────────────────────────────────────

describe('openReviewModal — star selection', () => {
    it('starts at Not Rated with no active stars', async () => {
        const p = openReviewModal(1, 'G')
        expect(activeStars().length).toBe(0)
        expect(starLabel()).toBe('Not Rated')
        pressEscape(); await p
    })

    it('clicking the 3rd star activates exactly 3 stars', async () => {
        const p = openReviewModal(1, 'G')
        stars()[2].click()
        expect(activeStars().length).toBe(3)
        expect(starLabel()).toBe('3 Stars')
        pressEscape(); await p
    })

    it('clicking the selected star again clears the rating', async () => {
        const p = openReviewModal(1, 'G')
        stars()[2].click()
        stars()[2].click()
        expect(activeStars().length).toBe(0)
        expect(starLabel()).toBe('Not Rated')
        pressEscape(); await p
    })

    it('legendary = all 5 stars active + legendary toggle active, labelled Legendary', async () => {
        const p = openReviewModal(1, 'G')
        stars()[5].click()
        expect(activeStars().length).toBe(6)
        expect(starLabel()).toBe('Legendary')
        pressEscape(); await p
    })

    it('existing 5-star review lights 5 stars but NOT the legendary toggle', async () => {
        const p = openReviewModal(1, 'G', makeReview({ stars: 5 }))
        expect(activeStars().length).toBe(5)
        expect(activeStars().every(b => !b.classList.contains('rev-star--legendary'))).toBe(true)
        expect(starLabel()).toBe('5 Stars')
        pressEscape(); await p
    })

    it('existing stars: -1 renders as Not Rated with nothing active', async () => {
        const p = openReviewModal(1, 'G', makeReview({ stars: -1 }))
        expect(activeStars().length).toBe(0)
        expect(starLabel()).toBe('Not Rated')
        pressEscape(); await p
    })

    it('existing stars: NaN renders as Not Rated with nothing active', async () => {
        const p = openReviewModal(1, 'G', makeReview({ stars: NaN }))
        expect(activeStars().length).toBe(0)
        expect(starLabel()).toBe('Not Rated')
        pressEscape(); await p
    })

    it('existing stars: 3.5 activates 3 stars but falls back to Not Rated label (contract)', async () => {
        // Fractional stars are not producible via the UI; the module highlights
        // floor(stars) buttons but has no label for the fraction.
        const p = openReviewModal(1, 'G', makeReview({ stars: 3.5 }))
        expect(activeStars().length).toBe(3)
        expect(starLabel()).toBe('Not Rated')
        pressEscape(); await p
    })

    it('existing stars: 99 activates every button and falls back to Not Rated label (contract)', async () => {
        const p = openReviewModal(1, 'G', makeReview({ stars: 99 }))
        expect(activeStars().length).toBe(6)
        expect(starLabel()).toBe('Not Rated')
        pressEscape(); await p
    })
})

// ── Sliders ───────────────────────────────────────────────────────────────────

describe('openReviewModal — sliders', () => {
    it('defaults every characteristic to 5 for a new review', async () => {
        const p = openReviewModal(1, 'G')
        for (const { key } of SLIDER_KEYS) expect(sliderInput(key).value).toBe('5')
        pressEscape(); await p
    })

    it('uses existing ratings and defaults missing keys to 5', async () => {
        const p = openReviewModal(1, 'G', makeReview({ ratings: { story: 9 } }))
        expect(sliderInput('story').value).toBe('9')
        expect(sliderInput('gameplay').value).toBe('5')
        pressEscape(); await p
    })

    it('shows an em-dash for a 0 value and the number otherwise', async () => {
        const p = openReviewModal(1, 'G')
        setSlider('story', 0)
        const row = sliderInput('story').closest('.rev-slider-row')!
        expect(row.querySelector('.rev-slider-val')!.textContent).toBe('—')
        setSlider('story', 7)
        expect(row.querySelector('.rev-slider-val')!.textContent).toBe('7')
        pressEscape(); await p
    })
})

// ── Tags ──────────────────────────────────────────────────────────────────────

describe('openReviewModal — tags', () => {
    it('ignores whitespace-only custom tags', async () => {
        const p = openReviewModal(1, 'G')
        addCustomTag('   ')
        expect(customPills().length).toBe(0)
        pressEscape(); await p
    })

    it('does not add a duplicate custom tag twice', async () => {
        const p = openReviewModal(1, 'G')
        addCustomTag('Cozy')
        addCustomTag('Cozy')
        expect(customPills().length).toBe(1)
        expect(customInput().value).toBe('')
        pressEscape(); await p
    })

    it('typing a preset tag name activates the preset instead of creating a pill', async () => {
        const p = openReviewModal(1, 'G')
        addCustomTag('Grindy')
        expect(customPills().length).toBe(0)
        expect(presetBtn('Grindy').classList.contains('rev-tag--active')).toBe(true)
        pressEscape(); await p
    })

    it('Enter in the custom input adds the tag', async () => {
        const p = openReviewModal(1, 'G')
        customInput().value = 'Speedrun'
        customInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(customPills().length).toBe(1)
        pressEscape(); await p
    })

    it('removing a custom pill excludes it from the save payload', async () => {
        const p = openReviewModal(1, 'G')
        addCustomTag('Keep')
        addCustomTag('Drop')
        const dropPill = customPills().find(b => b.querySelector('span')!.textContent === 'Drop')!
        ;(dropPill.querySelectorAll('span')[1] as HTMLElement).click() // × span
        expect(customPills().length).toBe(1)
        fetchMock.mockResolvedValue(okResponse(makeReview()))
        saveBtn().click()
        await tick()
        expect(fetchPayload(fetchMock).tags).toEqual(['Keep'])
        await p
    })

    it('existing tags render active presets and removable custom pills', async () => {
        const p = openReviewModal(1, 'G', makeReview({ tags: ['Grindy', 'My Own Tag'] }))
        expect(presetBtn('Grindy').classList.contains('rev-tag--active')).toBe(true)
        expect(customPills().length).toBe(1)
        expect(customPills()[0].querySelector('span')!.textContent).toBe('My Own Tag')
        pressEscape(); await p
    })

    it('toggling a preset tag off removes it from the payload', async () => {
        const p = openReviewModal(1, 'G', makeReview({ tags: ['Grindy'] }))
        presetBtn('Grindy').click()
        fetchMock.mockResolvedValue(okResponse(makeReview()))
        saveBtn().click()
        await tick()
        expect(fetchPayload(fetchMock).tags).toEqual([])
        await p
    })
})

// ── Badges ────────────────────────────────────────────────────────────────────

describe('openReviewModal — badges', () => {
    it('toggles a boolean badge on and off', async () => {
        const p = openReviewModal(1, 'G')
        const card = badgeCard('Hidden Gem')
        card.click()
        expect(card.classList.contains('rev-badge-pick--active')).toBe(true)
        card.click()
        expect(card.classList.contains('rev-badge-pick--active')).toBe(false)
        pressEscape(); await p
    })

    it('Replayed counter: activates at 1, increments, never drops below 1', async () => {
        const p = openReviewModal(1, 'G')
        const card = badgeCard('Replayed')
        const countRow = card.querySelector('.rev-badge-pick-count') as HTMLElement
        const countVal = card.querySelector('.rev-badge-count-val')!
        const [minus, plus] = card.querySelectorAll('.rev-badge-count-btn') as NodeListOf<HTMLButtonElement>

        expect(countRow.hidden).toBe(true)
        card.click()
        expect(countRow.hidden).toBe(false)
        expect(countVal.textContent).toBe('1')
        plus.click(); plus.click()
        expect(countVal.textContent).toBe('3')
        minus.click(); minus.click(); minus.click(); minus.click()
        expect(countVal.textContent).toBe('1') // floor at 1
        pressEscape(); await p
    })

    it('toggling Replayed off zeroes it in the payload, on again restores the shown count', async () => {
        const p = openReviewModal(1, 'G', makeReview({ badges: { replayed: 3 } }))
        const card = badgeCard('Replayed')
        const countRow = card.querySelector('.rev-badge-pick-count') as HTMLElement
        expect(countRow.hidden).toBe(false)
        expect(card.querySelector('.rev-badge-count-val')!.textContent).toBe('3')

        card.click() // off
        expect(countRow.hidden).toBe(true)
        card.click() // back on — restores displayed count
        expect(card.querySelector('.rev-badge-count-val')!.textContent).toBe('3')

        card.click() // off again for the payload
        fetchMock.mockResolvedValue(okResponse(makeReview()))
        saveBtn().click()
        await tick()
        expect(fetchPayload(fetchMock).badges.replayed).toBe(0)
        await p
    })

    it('+/− clicks do not toggle the card itself (stopPropagation)', async () => {
        const p = openReviewModal(1, 'G')
        const card = badgeCard('Replayed')
        const [, plus] = card.querySelectorAll('.rev-badge-count-btn') as NodeListOf<HTMLButtonElement>
        plus.click()
        // Card was never activated — plus on an inactive counter only bumps the hidden count.
        expect(card.classList.contains('rev-badge-pick--active')).toBe(false)
        pressEscape(); await p
    })
})

// ── Save flow ─────────────────────────────────────────────────────────────────

describe('openReviewModal — save', () => {
    it('PUTs the full payload and resolves with the server response', async () => {
        const serverReview = makeReview({ stars: 6, updatedAt: '2026-07-15T00:00:00.000Z' })
        fetchMock.mockResolvedValue(okResponse(serverReview))
        const existing = makeReview({ notes: [{ id: 'n1', text: 'note', pinned: false, createdAt: 'x' }] })
        const p = openReviewModal(42, 'G', existing)

        stars()[5].click()               // legendary
        setSlider('story', 9)
        addCustomTag('Custom')
        badgeCard('Hidden Gem').click()
        textarea().value = '  spaced review  '
        saveBtn().click()
        await tick()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, opts] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/local-reviews/42')
        expect((opts as RequestInit).method).toBe('PUT')
        expect((opts as any).headers['Content-Type']).toBe('application/json')

        const payload = fetchPayload(fetchMock)
        expect(payload.stars).toBe(6)
        expect(payload.ratings.story).toBe(9)
        expect(payload.ratings.gameplay).toBe(5)
        expect(payload.tags).toContain('Custom')
        expect(payload.badges.hiddenGem).toBe(true)
        expect(payload.review).toBe('spaced review')            // trimmed
        expect(payload.notes).toEqual(existing.notes)            // notes preserved
        await expect(p).resolves.toEqual(serverReview)
        expect(overlay()).toBeNull()
    })

    it('keeps the modal open and shows the server error message on a failed save', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'disk full' }) })
        const p = openReviewModal(1, 'G')
        let settled = false
        p.then(() => { settled = true })

        saveBtn().click()
        expect(saveBtn().disabled).toBe(true)
        expect(saveBtn().textContent).toBe('Saving…')
        await tick(8)

        expect(errorText()).toBe('disk full')
        expect(saveBtn().disabled).toBe(false)
        expect(saveBtn().textContent).toBe('Save Review')
        expect(overlay()).not.toBeNull()
        expect(settled).toBe(false) // promise still pending — user can retry
        pressEscape(); await p
    })

    it('falls back to HTTP status when the error body is not JSON', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('bad json') } })
        const p = openReviewModal(1, 'G')
        saveBtn().click()
        await tick(8)
        expect(errorText()).toBe('HTTP 502')
        pressEscape(); await p
    })

    it('falls back to HTTP status when the error body has no error field', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 418, json: async () => ({}) })
        const p = openReviewModal(1, 'G')
        saveBtn().click()
        await tick(8)
        expect(errorText()).toBe('HTTP 418')
        pressEscape(); await p
    })

    it('recovers from a network failure without closing', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        const p = openReviewModal(1, 'G')
        saveBtn().click()
        await tick(8)
        expect(errorText()).toBe('Failed to fetch')
        expect(saveBtn().disabled).toBe(false)
        expect(overlay()).not.toBeNull()
        pressEscape(); await p
    })

    it('a failed save can be retried and succeed', async () => {
        fetchMock
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(okResponse(makeReview({ stars: 2 })))
        const p = openReviewModal(1, 'G')
        saveBtn().click()
        await tick(8)
        expect(errorText()).toBe('offline')
        saveBtn().click()
        await tick(8)
        await expect(p).resolves.toMatchObject({ stars: 2 })
        expect(overlay()).toBeNull()
    })

    it('double-clicking Save fires exactly one request (button disabled)', async () => {
        let resolveFetch!: (v: unknown) => void
        fetchMock.mockReturnValue(new Promise(r => { resolveFetch = r }))
        const p = openReviewModal(1, 'G')
        saveBtn().click()
        saveBtn().click() // disabled — must not dispatch
        expect(fetchMock).toHaveBeenCalledTimes(1)
        resolveFetch(okResponse(makeReview()))
        await tick(8)
        await p
    })

    it('cancelling during a pending save resolves null; the late success does not resurrect the modal', async () => {
        let resolveFetch!: (v: unknown) => void
        fetchMock.mockReturnValue(new Promise(r => { resolveFetch = r }))
        const p = openReviewModal(1, 'G')
        saveBtn().click()
        await tick()
        cancelBtn().click()
        await expect(p).resolves.toBeNull()
        expect(overlay()).toBeNull()

        resolveFetch(okResponse(makeReview({ stars: 4 })))
        await tick(8)
        // Promise stays null (first resolve wins) and no overlay reappears.
        await expect(p).resolves.toBeNull()
        expect(overlay()).toBeNull()
    })
})

// ── Dismissal, keyboard & listener hygiene ────────────────────────────────────

describe('openReviewModal — dismissal', () => {
    it('Escape resolves null and removes the overlay', async () => {
        const p = openReviewModal(1, 'G')
        pressEscape()
        await expect(p).resolves.toBeNull()
        expect(overlay()).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('close button and Cancel resolve null', async () => {
        const p1 = openReviewModal(1, 'G')
        closeBtn().click()
        await expect(p1).resolves.toBeNull()

        const p2 = openReviewModal(1, 'G')
        cancelBtn().click()
        await expect(p2).resolves.toBeNull()
        expect(overlays().length).toBe(0)
    })

    it('clicking the backdrop closes; clicking inside the modal does not', async () => {
        const p = openReviewModal(1, 'G')
        document.querySelector('.rev-modal-body')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(overlay()).not.toBeNull()
        overlay()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await expect(p).resolves.toBeNull()
        expect(overlay()).toBeNull()
    })

    it('Escape discards unsaved edits without confirmation (contract — no unsaved-changes guard)', async () => {
        const p = openReviewModal(1, 'G')
        stars()[4].click()
        textarea().value = 'hours of writing'
        pressEscape()
        await expect(p).resolves.toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not leak document keydown listeners across repeated open/close cycles', async () => {
        const addSpy    = vi.spyOn(document, 'addEventListener')
        const removeSpy = vi.spyOn(document, 'removeEventListener')
        for (let i = 0; i < 5; i++) {
            const p = openReviewModal(i, `G${i}`)
            pressEscape()
            await p
        }
        const added   = addSpy.mock.calls.filter(c => c[0] === 'keydown').length
        const removed = removeSpy.mock.calls.filter(c => c[0] === 'keydown').length
        expect(added).toBe(5)
        expect(removed).toBe(added)
        // And a stray Escape after everything is closed must be a no-op.
        expect(() => pressEscape()).not.toThrow()
    })

    it('opening the modal twice stacks two dialogs; one Escape closes both (contract)', async () => {
        // Each instance registers its own document-level Escape handler, so a
        // single keypress dismisses every open instance — documented behavior.
        const p1 = openReviewModal(1, 'A')
        const p2 = openReviewModal(2, 'B')
        expect(overlays().length).toBe(2)
        pressEscape()
        await expect(p1).resolves.toBeNull()
        await expect(p2).resolves.toBeNull()
        expect(overlays().length).toBe(0)
    })
})

// ── Exported constants sanity ─────────────────────────────────────────────────

describe('exported constants', () => {
    it('SLIDER_KEYS and BADGES have unique ids', () => {
        expect(new Set(SLIDER_KEYS.map(s => s.key)).size).toBe(SLIDER_KEYS.length)
        expect(new Set(BADGES.map(b => b.id)).size).toBe(BADGES.length)
    })

    it('only Replayed is a counted badge', () => {
        expect(BADGES.filter(b => b.hasCount).map(b => b.id)).toEqual(['replayed'])
    })
})
