const COLORS = ['#4ecdc4', '#c9a84c', '#ffe580', '#ffffff', '#b57bee', '#ff6b9d', '#7ef5ee']

interface Particle {
    x: number; y: number
    vx: number; vy: number
    color: string
    size: number | null
    w: number | null
    h: number | null
    rot: number; rotV: number
    life: number; decay: number
}

export function fireParticles(sourceEl: Element, toastLabel = ''): void {
    const rect = sourceEl.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2

    const canvas = document.createElement('canvas')
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;'
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')!

    const particles: Particle[] = Array.from({ length: 90 }, () => {
        const angle = Math.random() * Math.PI * 2
        const speed = 3 + Math.random() * 9
        const isRect = Math.random() > 0.45
        return {
            x: cx, y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2.5,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            size: isRect ? null : 3 + Math.random() * 4,
            w: isRect ? 5 + Math.random() * 5 : null,
            h: isRect ? 2 + Math.random() * 3 : null,
            rot: Math.random() * Math.PI * 2,
            rotV: (Math.random() - 0.5) * 0.28,
            life: 1,
            decay: 0.014 + Math.random() * 0.014,
        }
    })

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        let alive = false
        for (const p of particles) {
            p.x  += p.vx
            p.y  += p.vy
            p.vy += 0.22
            p.vx *= 0.985
            p.life -= p.decay
            p.rot += p.rotV
            if (p.life <= 0) continue
            alive = true
            ctx.save()
            ctx.globalAlpha = Math.max(0, p.life)
            ctx.fillStyle = p.color
            ctx.translate(p.x, p.y)
            ctx.rotate(p.rot)
            if (p.size != null) {
                ctx.beginPath()
                ctx.arc(0, 0, p.size * Math.max(0.1, p.life), 0, Math.PI * 2)
                ctx.fill()
            } else {
                ctx.fillRect(-p.w! / 2, -p.h! / 2, p.w! * Math.max(0.1, p.life), p.h!)
            }
            ctx.restore()
        }
        alive ? requestAnimationFrame(draw) : canvas.remove()
    }

    requestAnimationFrame(draw)

    if (toastLabel) _showToast(toastLabel)
}

let _toastQueue = 0

function _showToast(label: string): void {
    const offset = _toastQueue * 56
    _toastQueue++

    const el = document.createElement('div')
    el.className = 'completion-toast'
    el.style.bottom = `${24 + offset}px`
    // Inline lucide `party-popper` (from Icon.svelte's ICONS registry), tone sage; label stays a text node (safe).
    el.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--clr-sage);vertical-align:-0.15em" aria-hidden="true"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg>'
    el.appendChild(document.createTextNode(` ${label} complete!`))
    document.body.appendChild(el)

    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('completion-toast--show')))

    setTimeout(() => {
        el.classList.remove('completion-toast--show')
        setTimeout(() => { el.remove(); _toastQueue-- }, 400)
    }, 3200)
}
