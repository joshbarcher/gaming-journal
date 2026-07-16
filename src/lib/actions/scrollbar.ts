import { OverlayScrollbars } from 'overlayscrollbars'

let _mainInstance: ReturnType<typeof OverlayScrollbars> | undefined

export function getScrollInstance(): ReturnType<typeof OverlayScrollbars> | undefined {
    return _mainInstance
}

export function scrollbar(element: HTMLElement) {
    // Track OUR instance — during in/out transitions the incoming element mounts
    // before the outgoing unmounts, so destroying via the shared _mainInstance
    // would tear down the new element's scrollbar and leak this one.
    const instance = OverlayScrollbars(element, {
        scrollbars: {
            theme: 'gj-theme',
            visibility: 'visible',
            autoHide: 'never',
            clickScroll: true,
        },
    })
    _mainInstance = instance

    let destroyed = false
    return {
        destroy() {
            if (destroyed) return
            destroyed = true
            instance.destroy()
            if (_mainInstance === instance) _mainInstance = undefined
        },
    }
}
