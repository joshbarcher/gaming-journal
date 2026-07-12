// Shared image lightbox — a single reusable modal appended to <body>, with prev/next,
// keyboard nav, and backdrop/close. Mirrors the game-page screenshot modal so mod
// galleries get the same experience. Uses the global `.shot-modal` styles.

let _el: HTMLElement | null = null
let _srcs: string[] = []
let _idx = 0

function nav(delta: number) {
    if (_srcs.length < 2) return
    _idx = (_idx + delta + _srcs.length) % _srcs.length
    ;(_el!.querySelector('.shot-modal-img') as HTMLImageElement).src = _srcs[_idx]
}
function close() { _el?.classList.remove('shot-modal--open') }

export function openLightbox(srcs: string[], index = 0) {
    if (typeof document === 'undefined' || !srcs.length) return

    if (!_el) {
        _el = document.createElement('div')
        _el.className = 'shot-modal'
        _el.innerHTML = `<div class="shot-modal-backdrop"></div><button class="shot-modal-prev shot-modal-nav" aria-label="Previous">&#8249;</button><img class="shot-modal-img" src="" alt="Image"><button class="shot-modal-next shot-modal-nav" aria-label="Next">&#8250;</button><button class="shot-modal-close" aria-label="Close">✕</button>`
        document.body.appendChild(_el)
        _el.querySelector('.shot-modal-backdrop')!.addEventListener('click', close)
        _el.querySelector('.shot-modal-close')!.addEventListener('click', close)
        _el.querySelector('.shot-modal-prev')!.addEventListener('click', () => nav(-1))
        _el.querySelector('.shot-modal-next')!.addEventListener('click', () => nav(1))
        document.addEventListener('keydown', (e) => {
            if (!_el?.classList.contains('shot-modal--open')) return
            if (e.key === 'Escape')     close()
            if (e.key === 'ArrowLeft')  nav(-1)
            if (e.key === 'ArrowRight') nav(1)
        })
        window.addEventListener('popstate', close)
    }

    _srcs = srcs
    _idx  = index
    ;(_el.querySelector('.shot-modal-img') as HTMLImageElement).src = srcs[index]
    const single = srcs.length <= 1
    ;(_el.querySelector('.shot-modal-prev') as HTMLElement).style.display = single ? 'none' : ''
    ;(_el.querySelector('.shot-modal-next') as HTMLElement).style.display = single ? 'none' : ''
    _el.classList.add('shot-modal--open')
}
