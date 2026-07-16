import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// particles.ts is canvas-driven; jsdom has no real 2d context, so we stub
// HTMLCanvasElement.prototype.getContext and drive requestAnimationFrame
// manually. Module has toast-queue state, so each test imports fresh.

let fireParticles: (sourceEl: Element, toastLabel?: string) => void
let rafQueue: FrameRequestCallback[]
let ctx2d: Record<string, ReturnType<typeof vi.fn>> & { globalAlpha: number; fillStyle: string }

/** Run queued rAF callbacks frame-by-frame until the queue drains (or cap). Returns frames run. */
function pumpFrames(max = 500): number {
    let frames = 0
    while (rafQueue.length && frames < max) {
        const batch = rafQueue.splice(0)
        for (const cb of batch) cb(frames * 16)
        frames++
    }
    return frames
}

const source = () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
}
const canvas = () => document.querySelector('canvas')
const toasts = () => [...document.querySelectorAll('.completion-toast')] as HTMLElement[]

beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    document.body.innerHTML = ''
    rafQueue = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rafQueue.push(cb)
        return rafQueue.length
    }))
    ctx2d = {
        clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
        translate: vi.fn(), rotate: vi.fn(), beginPath: vi.fn(),
        arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
        globalAlpha: 1, fillStyle: '',
    } as any
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as any)
    ;({ fireParticles } = await import('../lib/js/particles.js'))
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('fireParticles — canvas lifecycle', () => {
    it('appends a full-viewport, click-through overlay canvas', () => {
        fireParticles(source())
        const c = canvas()!
        expect(c).not.toBeNull()
        expect(c.width).toBe(window.innerWidth)
        expect(c.height).toBe(window.innerHeight)
        expect(c.style.pointerEvents).toBe('none')
        expect(c.style.position).toBe('fixed')
        expect(c.style.zIndex).toBe('9999')
    })

    it('draws on every frame while particles are alive', () => {
        fireParticles(source())
        expect(rafQueue.length).toBe(1)
        rafQueue.splice(0).forEach(cb => cb(0))
        expect(ctx2d.clearRect).toHaveBeenCalledTimes(1)
        // First frame: all 90 particles alive — one save/restore pair each.
        expect(ctx2d.save).toHaveBeenCalledTimes(90)
        expect(ctx2d.restore).toHaveBeenCalledTimes(90)
        // Both shapes rendered (circles via arc, rects via fillRect) — with 90
        // particles at ~45/55 split, both paths are hit with astronomical odds.
        expect(ctx2d.arc.mock.calls.length + ctx2d.fillRect.mock.calls.length).toBe(90)
    })

    it('removes the canvas and stops scheduling frames once every particle expires', () => {
        fireParticles(source())
        const frames = pumpFrames()
        // Max lifetime = 1 / 0.014 ≈ 72 frames — the loop must terminate on its own.
        expect(frames).toBeGreaterThan(30)
        expect(frames).toBeLessThan(100)
        expect(canvas()).toBeNull()
        expect(rafQueue.length).toBe(0) // nothing rescheduled after cleanup
    })

    it('two overlapping bursts each get their own canvas and both clean up', () => {
        fireParticles(source())
        fireParticles(source())
        expect(document.querySelectorAll('canvas').length).toBe(2)
        pumpFrames()
        expect(document.querySelectorAll('canvas').length).toBe(0)
    })

    it('handles a zero-size source element (jsdom default rect) without throwing', () => {
        expect(() => {
            fireParticles(source())
            pumpFrames()
        }).not.toThrow()
    })
})

describe('fireParticles — completion toast', () => {
    it('shows no toast when the label is empty', () => {
        fireParticles(source())
        pumpFrames()
        expect(toasts().length).toBe(0)
    })

    it('shows a toast with the label text', () => {
        fireParticles(source(), 'Boss Fight')
        expect(toasts().length).toBe(1)
        expect(toasts()[0].textContent).toBe('✦ Boss Fight complete!')
        expect(toasts()[0].style.bottom).toBe('24px')
    })

    it('adds the show class after the double-rAF kick', () => {
        fireParticles(source(), 'X')
        expect(toasts()[0].classList.contains('completion-toast--show')).toBe(false)
        pumpFrames()
        expect(toasts()[0].classList.contains('completion-toast--show')).toBe(true)
    })

    it('renders a label containing HTML as inert text', () => {
        fireParticles(source(), '<img src=x onerror=alert(1)>')
        expect(document.querySelector('.completion-toast img')).toBeNull()
        expect(toasts()[0].textContent).toContain('<img src=x onerror=alert(1)>')
    })

    it('removes the toast after the 3200ms + 400ms fade window', () => {
        fireParticles(source(), 'X')
        pumpFrames()
        vi.advanceTimersByTime(3599)
        expect(toasts().length).toBe(1)
        vi.advanceTimersByTime(1)
        expect(toasts().length).toBe(0)
    })

    it('stacks concurrent toasts with 56px offsets', () => {
        fireParticles(source(), 'First')
        fireParticles(source(), 'Second')
        fireParticles(source(), 'Third')
        const bottoms = toasts().map(t => t.style.bottom)
        expect(bottoms).toEqual(['24px', '80px', '136px'])
    })

    it('resets the stack position after toasts expire', () => {
        fireParticles(source(), 'First')
        pumpFrames()
        vi.advanceTimersByTime(3600)
        expect(toasts().length).toBe(0)

        fireParticles(source(), 'Later')
        expect(toasts()[0].style.bottom).toBe('24px') // back at the base slot
    })
})
