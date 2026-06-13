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
    el.textContent = `✦ ${label} complete!`
    document.body.appendChild(el)

    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('completion-toast--show')))

    setTimeout(() => {
        el.classList.remove('completion-toast--show')
        setTimeout(() => { el.remove(); _toastQueue-- }, 400)
    }, 3200)
}
