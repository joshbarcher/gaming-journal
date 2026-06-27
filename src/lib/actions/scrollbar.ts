import { OverlayScrollbars } from 'overlayscrollbars'

let _mainInstance: ReturnType<typeof OverlayScrollbars> | undefined

export function getScrollInstance(): ReturnType<typeof OverlayScrollbars> | undefined {
    return _mainInstance
}

export function scrollbar(element: HTMLElement) {
    _mainInstance = OverlayScrollbars(element, {
        scrollbars: {
            theme: 'gj-theme',
            visibility: 'visible',
            autoHide: 'never',
            clickScroll: true,
        },
    })

    return {
        destroy() {
            _mainInstance?.destroy()
            _mainInstance = undefined
        },
    }
}
