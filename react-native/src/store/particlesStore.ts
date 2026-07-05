// Backs ParticlesHost.tsx — root-mounted overlay (see PLAN.md's standing rule), same family as
// ScreenshotLightboxHost/ReviewEditor. Fires a confetti burst + stacked toast, replacing the web's
// `fireParticles()` (src/lib/js/particles.ts) canvas-based particle system.
import { create } from 'zustand'

export type Burst = { id: string; x: number; y: number }
export type Toast = { id: string; label: string }

type ParticlesState = {
    bursts: Burst[]
    toasts: Toast[]
    fire: (x: number, y: number, label?: string) => void
    removeBurst: (id: string) => void
    removeToast: (id: string) => void
}

let counter = 0
function nextId(): string {
    counter += 1
    return `p${Date.now()}-${counter}`
}

export const useParticlesStore = create<ParticlesState>((set) => ({
    bursts: [],
    toasts: [],
    fire: (x, y, label) => {
        const burstId = nextId()
        set(state => ({ bursts: [...state.bursts, { id: burstId, x, y }] }))
        if (label) {
            const toastId = nextId()
            set(state => ({ toasts: [...state.toasts, { id: toastId, label }] }))
        }
    },
    removeBurst: (id) => set(state => ({ bursts: state.bursts.filter(b => b.id !== id) })),
    removeToast: (id) => set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),
}))
