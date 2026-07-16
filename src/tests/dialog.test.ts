import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { inputDialog, confirmDialog, newPageDialog, showError } from '../lib/js/dialog.js'

// Resolves true if `p` settles within a macrotask, false if it is still pending.
function settledWithinTick(p: Promise<unknown>): Promise<boolean> {
    return Promise.race([
        p.then(() => true, () => true),
        new Promise<boolean>(r => setTimeout(() => r(false), 0)),
    ])
}

function pressKey(key: string, target: EventTarget = document) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

function overlays() {
    return document.querySelectorAll('.dialog-overlay')
}

beforeEach(() => {
    document.body.innerHTML = ''
})

afterEach(() => {
    // Failsafe: close any dialog a failed assertion left open so its document
    // keydown listener cannot bleed into the next test.
    pressKey('Escape')
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
})

// ── inputDialog ───────────────────────────────────────────────────────────────

describe('inputDialog — open state', () => {
    it('mounts one overlay with title, input, and two buttons', () => {
        void inputDialog('Rename', 'hint', 'old')
        expect(overlays().length).toBe(1)
        expect(document.querySelector('.dialog-title')?.textContent).toBe('Rename')
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        expect(input.placeholder).toBe('hint')
        expect(input.value).toBe('old')
        expect(document.querySelectorAll('.dialog-btn').length).toBe(2)
        pressKey('Escape')
    })

    it('focuses the input on open', () => {
        void inputDialog('T')
        expect(document.activeElement).toBe(document.querySelector('.dialog-input'))
        pressKey('Escape')
    })

    it('does not parse HTML in the title (no XSS through title)', () => {
        void inputDialog('<img src=x onerror="window.__pwned=1">')
        expect(document.querySelector('.dialog-title img')).toBeNull()
        expect(document.querySelector('.dialog-title')?.textContent)
            .toBe('<img src=x onerror="window.__pwned=1">')
        expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
        pressKey('Escape')
    })

    it('does not parse HTML injected through placeholder or defaultValue', () => {
        void inputDialog('T', '<b>ph</b>', '<script>window.__pwned2=1</script>')
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        expect(input.placeholder).toBe('<b>ph</b>')
        expect(input.value).toBe('<script>window.__pwned2=1</script>')
        expect((window as unknown as Record<string, unknown>).__pwned2).toBeUndefined()
        pressKey('Escape')
    })
})

describe('inputDialog — resolution', () => {
    it('resolves the trimmed value on OK click', async () => {
        const p = inputDialog('T')
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        input.value = '  hello  '
        document.querySelector<HTMLButtonElement>('.dialog-btn--create')!.click()
        await expect(p).resolves.toBe('hello')
        expect(overlays().length).toBe(0)
    })

    it('resolves null on Cancel click and removes the overlay', async () => {
        const p = inputDialog('T')
        document.querySelector<HTMLButtonElement>('.dialog-btn--cancel')!.click()
        await expect(p).resolves.toBeNull()
        expect(overlays().length).toBe(0)
    })

    it('resolves the value on Enter inside the input', async () => {
        const p = inputDialog('T')
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        input.value = 'via-enter'
        pressKey('Enter', input)
        await expect(p).resolves.toBe('via-enter')
    })

    it('resolves null on Escape pressed anywhere in the document', async () => {
        const p = inputDialog('T')
        pressKey('Escape')
        await expect(p).resolves.toBeNull()
        expect(overlays().length).toBe(0)
    })

    it('resolves null on Escape pressed inside the input (single resolution, no double-close error)', async () => {
        const p = inputDialog('T')
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        pressKey('Escape', input)
        await expect(p).resolves.toBeNull()
        expect(overlays().length).toBe(0)
    })

    it('resolves null on backdrop click', async () => {
        const p = inputDialog('T')
        const overlay = document.querySelector<HTMLElement>('.dialog-overlay')!
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await expect(p).resolves.toBeNull()
    })

    it('does NOT close when clicking inside the dialog box', async () => {
        const p = inputDialog('T')
        const box = document.querySelector<HTMLElement>('.dialog-box')!
        box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(await settledWithinTick(p)).toBe(false)
        expect(overlays().length).toBe(1)
        pressKey('Escape')
        await p
    })

    it('roundtrips unicode input exactly', async () => {
        const p = inputDialog('T')
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        input.value = 'Ⅶ 七 🎮 déjà'
        pressKey('Enter', input)
        await expect(p).resolves.toBe('Ⅶ 七 🎮 déjà')
    })
})

describe('inputDialog — empty submit guard', () => {
    it('stays open and keeps the promise pending on OK with an empty value', async () => {
        const p = inputDialog('T')
        document.querySelector<HTMLButtonElement>('.dialog-btn--create')!.click()
        expect(await settledWithinTick(p)).toBe(false)
        expect(overlays().length).toBe(1)
        pressKey('Escape')
        await p
    })

    it('stays open on Enter with a whitespace-only value and refocuses the input', async () => {
        const p = inputDialog('T')
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        input.value = '   '
        input.blur()
        pressKey('Enter', input)
        expect(await settledWithinTick(p)).toBe(false)
        expect(document.activeElement).toBe(input)
        pressKey('Escape')
        await p
    })
})

describe('inputDialog — listener hygiene', () => {
    it('removes its document keydown listener on close (N open/close cycles leak nothing)', async () => {
        const addSpy    = vi.spyOn(document, 'addEventListener')
        const removeSpy = vi.spyOn(document, 'removeEventListener')
        for (let i = 0; i < 5; i++) {
            const p = inputDialog('T')
            pressKey('Escape')
            await p
        }
        const added   = addSpy.mock.calls.filter(c => c[0] === 'keydown').length
        const removed = removeSpy.mock.calls.filter(c => c[0] === 'keydown').length
        expect(added).toBe(5)
        expect(removed).toBe(5)
        expect(document.body.children.length).toBe(0)
    })

    it('is inert after close: further Escape presses do not throw or re-add DOM', async () => {
        const p = inputDialog('T')
        pressKey('Escape')
        await p
        pressKey('Escape')
        pressKey('Escape')
        expect(overlays().length).toBe(0)
    })

    it('rapid double Escape resolves exactly once with null', async () => {
        const p = inputDialog('T')
        pressKey('Escape')
        pressKey('Escape')
        await expect(p).resolves.toBeNull()
        expect(overlays().length).toBe(0)
    })
})

// ── confirmDialog ─────────────────────────────────────────────────────────────

describe('confirmDialog', () => {
    it('renders title, body, and a custom confirm label', () => {
        void confirmDialog('Delete?', 'This cannot be undone', 'Delete')
        expect(document.querySelector('.dialog-title')?.textContent).toBe('Delete?')
        expect(document.querySelector('.dialog-body')?.textContent).toBe('This cannot be undone')
        expect(document.querySelector('.dialog-btn--confirm')?.textContent).toBe('Delete')
        pressKey('Escape')
    })

    it('defaults the confirm label to "Confirm"', () => {
        void confirmDialog('T', 'b')
        expect(document.querySelector('.dialog-btn--confirm')?.textContent).toBe('Confirm')
        pressKey('Escape')
    })

    it('focuses the confirm button on open', () => {
        void confirmDialog('T', 'b')
        expect(document.activeElement).toBe(document.querySelector('.dialog-btn--confirm'))
        pressKey('Escape')
    })

    it('does not parse HTML in the body (no XSS through body text)', () => {
        void confirmDialog('T', '<script>window.__pwned3=1</script><img src=x>')
        expect(document.querySelector('.dialog-body script')).toBeNull()
        expect(document.querySelector('.dialog-body img')).toBeNull()
        expect((window as unknown as Record<string, unknown>).__pwned3).toBeUndefined()
        pressKey('Escape')
    })

    it('resolves true on confirm click', async () => {
        const p = confirmDialog('T', 'b')
        document.querySelector<HTMLButtonElement>('.dialog-btn--confirm')!.click()
        await expect(p).resolves.toBe(true)
        expect(overlays().length).toBe(0)
    })

    it('resolves false on cancel click', async () => {
        const p = confirmDialog('T', 'b')
        document.querySelector<HTMLButtonElement>('.dialog-btn--cancel')!.click()
        await expect(p).resolves.toBe(false)
    })

    it('resolves false on Escape', async () => {
        const p = confirmDialog('T', 'b')
        pressKey('Escape')
        await expect(p).resolves.toBe(false)
    })

    it('resolves true on Enter anywhere in the document', async () => {
        const p = confirmDialog('T', 'b')
        pressKey('Enter')
        await expect(p).resolves.toBe(true)
    })

    it('resolves false on backdrop click but not on box click', async () => {
        const p = confirmDialog('T', 'b')
        const box = document.querySelector<HTMLElement>('.dialog-box')!
        box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(await settledWithinTick(p)).toBe(false)
        document.querySelector<HTMLElement>('.dialog-overlay')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await expect(p).resolves.toBe(false)
    })

    // Both dialogs register their own document-level keydown listener, so one
    // Escape press closes every open dialog, not just the topmost. Contract test
    // documenting the current (arguably surprising) stacking behavior.
    it('a single Escape closes ALL stacked dialogs (documents global-listener behavior)', async () => {
        const p1 = confirmDialog('First', 'a')
        const p2 = confirmDialog('Second', 'b')
        expect(overlays().length).toBe(2)
        pressKey('Escape')
        await expect(p1).resolves.toBe(false)
        await expect(p2).resolves.toBe(false)
        expect(overlays().length).toBe(0)
    })

    it('a single Enter confirms ALL stacked confirm dialogs (documents global-listener behavior)', async () => {
        const p1 = confirmDialog('First', 'a')
        const p2 = confirmDialog('Second', 'b')
        pressKey('Enter')
        await expect(p1).resolves.toBe(true)
        await expect(p2).resolves.toBe(true)
        expect(overlays().length).toBe(0)
    })

    it('removes its document keydown listener after close', async () => {
        const addSpy    = vi.spyOn(document, 'addEventListener')
        const removeSpy = vi.spyOn(document, 'removeEventListener')
        for (let i = 0; i < 4; i++) {
            const p = confirmDialog('T', 'b')
            pressKey('Enter')
            await p
        }
        const added   = addSpy.mock.calls.filter(c => c[0] === 'keydown').length
        const removed = removeSpy.mock.calls.filter(c => c[0] === 'keydown').length
        expect(added).toBe(4)
        expect(removed).toBe(4)
        expect(document.body.children.length).toBe(0)
    })
})

// ── newPageDialog ─────────────────────────────────────────────────────────────

describe('newPageDialog', () => {
    it('renders 5 page types with the first pre-selected and the title input focused', () => {
        void newPageDialog()
        const radios = document.querySelectorAll<HTMLInputElement>('input[name="page-type"]')
        expect(radios.length).toBe(5)
        expect(radios[0].checked).toBe(true)
        expect(radios[0].value).toBe('progress')
        expect(document.activeElement).toBe(document.querySelector('.dialog-input'))
        pressKey('Escape')
    })

    it('resolves title + default type on Create click', async () => {
        const p = newPageDialog()
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        input.value = ' My Page '
        document.querySelector<HTMLButtonElement>('.dialog-btn--create')!.click()
        await expect(p).resolves.toEqual({ title: 'My Page', type: 'progress' })
        expect(overlays().length).toBe(0)
    })

    it('resolves the selected type after changing the radio', async () => {
        const p = newPageDialog()
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        input.value = 'Notes page'
        const notesRadio = document.querySelector<HTMLInputElement>('input[name="page-type"][value="notes"]')!
        notesRadio.click()
        document.querySelector<HTMLButtonElement>('.dialog-btn--create')!.click()
        await expect(p).resolves.toEqual({ title: 'Notes page', type: 'notes' })
    })

    it('stays open on Create with an empty title', async () => {
        const p = newPageDialog()
        document.querySelector<HTMLButtonElement>('.dialog-btn--create')!.click()
        expect(await settledWithinTick(p)).toBe(false)
        expect(overlays().length).toBe(1)
        pressKey('Escape')
        await p
    })

    it('submits on Enter inside the title input', async () => {
        const p = newPageDialog()
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        input.value = 'Via enter'
        pressKey('Enter', input)
        await expect(p).resolves.toEqual({ title: 'Via enter', type: 'progress' })
    })

    it('submits on Enter outside the title input (document-level)', async () => {
        const p = newPageDialog()
        const input = document.querySelector<HTMLInputElement>('.dialog-input')!
        input.value = 'Doc enter'
        pressKey('Enter', document.body)
        await expect(p).resolves.toEqual({ title: 'Doc enter', type: 'progress' })
    })

    it('resolves null on Escape and on Cancel', async () => {
        const p1 = newPageDialog()
        pressKey('Escape')
        await expect(p1).resolves.toBeNull()

        const p2 = newPageDialog()
        document.querySelector<HTMLButtonElement>('.dialog-btn--cancel')!.click()
        await expect(p2).resolves.toBeNull()
        expect(overlays().length).toBe(0)
    })

    it('leaves no DOM or document listeners behind after repeated open/close', async () => {
        const addSpy    = vi.spyOn(document, 'addEventListener')
        const removeSpy = vi.spyOn(document, 'removeEventListener')
        for (let i = 0; i < 3; i++) {
            const p = newPageDialog()
            pressKey('Escape')
            await p
        }
        const added   = addSpy.mock.calls.filter(c => c[0] === 'keydown').length
        const removed = removeSpy.mock.calls.filter(c => c[0] === 'keydown').length
        expect(added).toBe(3)
        expect(removed).toBe(3)
        expect(document.body.children.length).toBe(0)
    })
})

// ── showError ─────────────────────────────────────────────────────────────────

describe('showError', () => {
    beforeEach(() => {
        vi.useFakeTimers({
            toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
        })
    })

    it('renders the message as plain text (no XSS through message)', () => {
        showError('<img src=x onerror="window.__pwned4=1"><b>hi</b>')
        const toast = document.querySelector('.error-toast')!
        expect(toast.textContent).toBe('<img src=x onerror="window.__pwned4=1"><b>hi</b>')
        expect(toast.querySelector('img')).toBeNull()
        expect((window as unknown as Record<string, unknown>).__pwned4).toBeUndefined()
    })

    it('adds the show class after two animation frames', () => {
        showError('boom')
        const toast = document.querySelector('.error-toast')!
        expect(toast.classList.contains('error-toast--show')).toBe(false)
        vi.advanceTimersByTime(50) // two rAF frames
        expect(toast.classList.contains('error-toast--show')).toBe(true)
    })

    it('removes the show class at ~4s and the element itself 350ms later', () => {
        showError('boom')
        const toast = document.querySelector('.error-toast')!
        vi.advanceTimersByTime(4000)
        expect(toast.classList.contains('error-toast--show')).toBe(false)
        expect(document.body.contains(toast)).toBe(true)
        vi.advanceTimersByTime(400)
        expect(document.body.contains(toast)).toBe(false)
    })

    it('stacks multiple toasts independently and removes them all', () => {
        showError('one')
        showError('two')
        showError('three')
        expect(document.querySelectorAll('.error-toast').length).toBe(3)
        vi.advanceTimersByTime(5000)
        expect(document.querySelectorAll('.error-toast').length).toBe(0)
    })

    it('handles an empty message without throwing', () => {
        expect(() => showError('')).not.toThrow()
        expect(document.querySelector('.error-toast')?.textContent).toBe('')
    })
})
