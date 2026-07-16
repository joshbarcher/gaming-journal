import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
    const instances: { destroy: ReturnType<typeof vi.fn> }[] = []
    const OverlayScrollbars = vi.fn(() => {
        const inst = { destroy: vi.fn() }
        instances.push(inst)
        return inst
    })
    return { instances, OverlayScrollbars }
})

vi.mock('overlayscrollbars', () => ({ OverlayScrollbars: h.OverlayScrollbars }))

import { scrollbar, getScrollInstance } from '../lib/actions/scrollbar.js'

beforeEach(() => {
    h.instances.length = 0
    h.OverlayScrollbars.mockClear()
    // The module keeps _mainInstance across tests — clear it via a throwaway action.
    scrollbar(document.createElement('div')).destroy()
    h.instances.length = 0
    h.OverlayScrollbars.mockClear()
})

describe('scrollbar action — init', () => {
    it('initializes OverlayScrollbars on the element with the gj-theme config', () => {
        const el = document.createElement('div')
        const action = scrollbar(el)
        expect(h.OverlayScrollbars).toHaveBeenCalledTimes(1)
        expect(h.OverlayScrollbars).toHaveBeenCalledWith(el, {
            scrollbars: {
                theme:       'gj-theme',
                visibility:  'visible',
                autoHide:    'never',
                clickScroll: true,
            },
        })
        action.destroy()
    })

    it('exposes the live instance through getScrollInstance', () => {
        expect(getScrollInstance()).toBeUndefined()
        const action = scrollbar(document.createElement('div'))
        expect(getScrollInstance()).toBe(h.instances[0])
        action.destroy()
    })
})

describe('scrollbar action — destroy', () => {
    it('destroy tears down the instance and clears getScrollInstance', () => {
        const action = scrollbar(document.createElement('div'))
        action.destroy()
        expect(h.instances[0].destroy).toHaveBeenCalledTimes(1)
        expect(getScrollInstance()).toBeUndefined()
    })

    it('destroy is idempotent — calling it twice does not throw or double-destroy', () => {
        const action = scrollbar(document.createElement('div'))
        action.destroy()
        expect(() => action.destroy()).not.toThrow()
        expect(h.instances[0].destroy).toHaveBeenCalledTimes(1)
    })

    it('a full init/destroy cycle can repeat (remount after route change)', () => {
        for (let i = 0; i < 3; i++) {
            const action = scrollbar(document.createElement('div'))
            expect(getScrollInstance()).toBe(h.instances[i])
            action.destroy()
            expect(getScrollInstance()).toBeUndefined()
        }
        expect(h.instances.every(inst => inst.destroy.mock.calls.length === 1)).toBe(true)
    })

    it('destroying the first action tears down its OWN instance, not a later one', () => {
        // Regression: destroy() once operated on the shared module-level _mainInstance,
        // so during overlapping mounts (Svelte in/out transitions) the outgoing element's
        // destroy killed the NEW element's scrollbar and leaked its own.
        const action1 = scrollbar(document.createElement('div'))
        const action2 = scrollbar(document.createElement('div'))
        const [inst1, inst2] = h.instances

        action1.destroy()
        expect(inst1.destroy).toHaveBeenCalledTimes(1)
        expect(inst2.destroy).not.toHaveBeenCalled()

        action2.destroy()
        expect(inst2.destroy).toHaveBeenCalledTimes(1)
    })

    it('overlapping mounts: the shared getScrollInstance keeps pointing at the newest live instance', () => {
        const action1 = scrollbar(document.createElement('div'))
        const action2 = scrollbar(document.createElement('div'))
        const [, inst2] = h.instances

        action1.destroy()
        // The outgoing element's destroy must not clear the newer element's shared handle.
        expect(getScrollInstance()).toBe(inst2)

        action2.destroy()
        expect(getScrollInstance()).toBeUndefined()
    })
})
