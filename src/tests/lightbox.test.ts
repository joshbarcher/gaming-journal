import { describe, it, expect, vi, beforeEach } from 'vitest'

// lightbox.ts keeps module-level singleton state (_el, _srcs, _idx), so every
// test gets a fresh module instance via resetModules + dynamic import.
let openLightbox: (srcs: string[], index?: number) => void

const modal   = () => document.querySelector('.shot-modal') as HTMLElement | null
const img     = () => document.querySelector('.shot-modal-img') as HTMLImageElement
const imgSrc  = () => img().getAttribute('src')
const prevBtn = () => document.querySelector('.shot-modal-prev') as HTMLElement
const nextBtn = () => document.querySelector('.shot-modal-next') as HTMLElement
const isOpen  = () => modal()?.classList.contains('shot-modal--open') ?? false

const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

beforeEach(async () => {
    vi.resetModules()
    document.body.innerHTML = ''
    ;({ openLightbox } = await import('../lib/js/lightbox.js'))
})

describe('openLightbox — basics', () => {
    it('does nothing for an empty src list', () => {
        openLightbox([])
        expect(modal()).toBeNull()
    })

    it('creates the modal once and reuses it across opens', () => {
        openLightbox(['a.png'])
        openLightbox(['b.png'])
        expect(document.querySelectorAll('.shot-modal').length).toBe(1)
        expect(imgSrc()).toBe('b.png')
        expect(isOpen()).toBe(true)
    })

    it('hides prev/next for a single image and shows them for multiple', () => {
        openLightbox(['only.png'])
        expect(prevBtn().style.display).toBe('none')
        expect(nextBtn().style.display).toBe('none')

        openLightbox(['a.png', 'b.png'])
        expect(prevBtn().style.display).toBe('')
        expect(nextBtn().style.display).toBe('')
    })

    it('shows the image at the requested start index', () => {
        openLightbox(['a.png', 'b.png', 'c.png'], 2)
        expect(imgSrc()).toBe('c.png')
    })

    it('accepts an empty-string src without crashing (contract — renders a broken image)', () => {
        openLightbox([''])
        expect(imgSrc()).toBe('')
        expect(isOpen()).toBe(true)
    })
})

describe('openLightbox — navigation & wrapping', () => {
    it('next wraps forward past the last image', () => {
        openLightbox(['a.png', 'b.png', 'c.png'], 2)
        nextBtn().click()
        expect(imgSrc()).toBe('a.png')
    })

    it('prev wraps backward past the first image', () => {
        openLightbox(['a.png', 'b.png', 'c.png'], 0)
        prevBtn().click()
        expect(imgSrc()).toBe('c.png')
    })

    it('rapid next clicks far past the array bounds stay in range', () => {
        const srcs = ['a.png', 'b.png', 'c.png']
        openLightbox(srcs, 0)
        for (let i = 0; i < 7; i++) nextBtn().click()
        expect(imgSrc()).toBe('b.png') // 7 % 3 = 1
        for (let i = 0; i < 11; i++) prevBtn().click()
        expect(srcs).toContain(imgSrc())
    })

    it('nav is a no-op with a single image (even via keyboard)', () => {
        openLightbox(['only.png'])
        key('ArrowRight')
        key('ArrowLeft')
        expect(imgSrc()).toBe('only.png')
    })

    it('clamps or wraps an out-of-range start index instead of showing "undefined"', () => {
        // REGRESSION: lightbox.ts — openLightbox(srcs, index) once assigned srcs[index]
        // to img.src without bounds-checking, so an index >= srcs.length (or negative)
        // set src to the literal "undefined" and rendered a broken image. Now the index
        // is clamped/wrapped into range; this guards the "undefined" src from returning.
        const srcs = ['a.png', 'b.png']
        openLightbox(srcs, 5)
        expect(srcs).toContain(imgSrc())
    })

    it('nav from a clamped start index moves from the first image (regression companion)', () => {
        openLightbox(['a.png', 'b.png', 'c.png'], 5) // clamped to 0
        nextBtn().click()
        expect(imgSrc()).toBe('b.png')
    })
})

describe('openLightbox — keyboard & closing', () => {
    it('Escape closes, arrows navigate while open', () => {
        openLightbox(['a.png', 'b.png'], 0)
        key('ArrowRight')
        expect(imgSrc()).toBe('b.png')
        key('ArrowLeft')
        expect(imgSrc()).toBe('a.png')
        key('Escape')
        expect(isOpen()).toBe(false)
    })

    it('ignores keys while closed', () => {
        openLightbox(['a.png', 'b.png'], 0)
        key('Escape')
        key('ArrowRight')
        expect(imgSrc()).toBe('a.png') // unchanged after close
        expect(isOpen()).toBe(false)
    })

    it('backdrop click closes', () => {
        openLightbox(['a.png'])
        ;(document.querySelector('.shot-modal-backdrop') as HTMLElement).click()
        expect(isOpen()).toBe(false)
    })

    it('close button closes', () => {
        openLightbox(['a.png'])
        ;(document.querySelector('.shot-modal-close') as HTMLElement).click()
        expect(isOpen()).toBe(false)
    })

    it('popstate (browser back) closes', () => {
        openLightbox(['a.png'])
        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(isOpen()).toBe(false)
    })

    it('close keeps the element in the DOM for reuse and reopen works', () => {
        openLightbox(['a.png', 'b.png'])
        key('Escape')
        expect(modal()).not.toBeNull()
        openLightbox(['c.png'], 0)
        expect(isOpen()).toBe(true)
        expect(imgSrc()).toBe('c.png')
        expect(document.querySelectorAll('.shot-modal').length).toBe(1)
    })

    it('registers exactly one keydown listener no matter how many times it opens', () => {
        const addSpy = vi.spyOn(document, 'addEventListener')
        openLightbox(['a.png'])
        openLightbox(['b.png'])
        openLightbox(['c.png'])
        expect(addSpy.mock.calls.filter(c => c[0] === 'keydown').length).toBe(1)
        addSpy.mockRestore()
    })
})
