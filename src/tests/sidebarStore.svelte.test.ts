// Adversarial tests for src/lib/sidebar.svelte.ts
//
// Pure rune state container (no async), so the attack surface is reactivity:
// deep-proxy mutation vs wholesale replacement, derived consistency after
// burst mutations, and effect teardown not leaking reactions.

import { describe, it, expect, beforeEach } from 'vitest'
import { flushSync } from 'svelte'
import { store } from '$lib/sidebar.svelte.js'

function resetStore() {
    store.pages          = []
    store.nowPlaying     = null
    store.lastPlayed     = null
    store.alertsCount    = 0
    store.saleAlerts     = []
    store.historyAppid   = null
    store.counts         = { library: 0, wishlist: 0, favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, franchises: 0 }
    store.pin            = null
    store.appSidebarOpen = false
}

beforeEach(resetStore)

describe('sidebar store', () => {
    it('has safe defaults after reset (nulls and zeros, no undefined)', () => {
        expect(store.pages).toEqual([])
        expect(store.nowPlaying).toBeNull()
        expect(store.lastPlayed).toBeNull()
        expect(store.alertsCount).toBe(0)
        expect(store.saleAlerts).toEqual([])
        expect(store.historyAppid).toBeNull()
        expect(store.pin).toBeNull()
        expect(store.appSidebarOpen).toBe(false)
        expect(Object.values(store.counts).every(v => v === 0)).toBe(true)
    })

    it('deep-proxy mutation of counts fields is reactive (no wholesale replace needed)', () => {
        const seen: number[] = []
        const cleanup = $effect.root(() => {
            $effect(() => { seen.push(store.counts.library) })
        })
        flushSync()
        store.counts.library = 7   // nested field mutation, not object replacement
        flushSync()
        cleanup()
        expect(seen).toEqual([0, 7])
    })

    it('wholesale counts replacement is reactive too, and losing keys yields undefined not a crash', () => {
        const seen: unknown[] = []
        const cleanup = $effect.root(() => {
            $effect(() => { seen.push(store.counts.backlog) })
        })
        flushSync()
        // A sloppy API response could replace counts with a partial object; the
        // store's type forbids it but nothing enforces it at runtime.
        store.counts = { library: 1 } as never
        flushSync()
        cleanup()
        expect(seen).toEqual([0, undefined])
    })

    it('array push on saleAlerts is reactive through the deep proxy', () => {
        const seen: number[] = []
        const cleanup = $effect.root(() => {
            $effect(() => { seen.push(store.saleAlerts.length) })
        })
        flushSync()
        store.saleAlerts.push({ appid: 620, cut: 50 })
        store.saleAlerts.push({ appid: 220, cut: 75 })
        flushSync()
        cleanup()
        // Two synchronous pushes coalesce into one effect flush: 0 → 2.
        expect(seen).toEqual([0, 2])
    })

    it('derived state is consistent after a burst of mixed mutations (single coherent flush)', () => {
        const snapshots: string[] = []
        const cleanup = $effect.root(() => {
            const summary = $derived(
                `${store.nowPlaying?.name ?? 'idle'}|${store.alertsCount}|${store.counts.inProgress}`
            )
            $effect(() => { snapshots.push(summary) })
        })
        flushSync()
        // Burst: several fields change "at once" as a poller merge would do.
        store.nowPlaying = { appid: 1091500, name: 'Cyberpunk 2077', elapsed: '1h 12m' }
        store.alertsCount = 3
        store.counts.inProgress = 5
        store.nowPlaying = { appid: 1091500, name: 'Cyberpunk 2077', elapsed: '1h 13m' }
        flushSync()
        cleanup()
        // No torn intermediate states — exactly initial + one coherent final snapshot.
        expect(snapshots).toEqual(['idle|0|0', 'Cyberpunk 2077|3|5'])
    })

    it('clearing nowPlaying back to null is reactive and does not strand stale derived values', () => {
        const seen: (string | null)[] = []
        const cleanup = $effect.root(() => {
            const name = $derived(store.nowPlaying?.name ?? null)
            $effect(() => { seen.push(name) })
        })
        flushSync()
        store.nowPlaying = { appid: 570, name: 'Dota 2' }
        flushSync()
        store.nowPlaying = null
        flushSync()
        cleanup()
        expect(seen).toEqual([null, 'Dota 2', null])
    })

    it('effects torn down via $effect.root cleanup stop observing (teardown safety)', () => {
        const seen: boolean[] = []
        const cleanup = $effect.root(() => {
            $effect(() => { seen.push(store.appSidebarOpen) })
        })
        flushSync()
        cleanup()
        store.appSidebarOpen = true
        flushSync()
        // Mutation after teardown must not re-run the effect (simulates a job
        // finishing after the observing component unmounted).
        expect(seen).toEqual([false])
        expect(store.appSidebarOpen).toBe(true) // state itself still updated
    })

    it('rapid open/close toggling of appSidebarOpen settles on the final value', () => {
        const seen: boolean[] = []
        const cleanup = $effect.root(() => {
            $effect(() => { seen.push(store.appSidebarOpen) })
        })
        flushSync()
        for (let i = 0; i < 25; i++) store.appSidebarOpen = !store.appSidebarOpen
        flushSync()
        cleanup()
        // 25 synchronous flips coalesce to one re-run with the final value (true).
        expect(seen).toEqual([false, true])
    })

    it('mutating an object AFTER storing it in state still reacts (proxy wraps on write)', () => {
        const info = { appid: 400, name: 'Portal' }
        store.lastPlayed = info
        const seen: string[] = []
        const cleanup = $effect.root(() => {
            $effect(() => { seen.push(store.lastPlayed?.name ?? '') })
        })
        flushSync()
        // Mutate through the store (the proxy), the supported path.
        store.lastPlayed!.name = 'Portal 2'
        flushSync()
        cleanup()
        expect(seen).toEqual(['Portal', 'Portal 2'])
    })

    it('CONTRACT: mutating the ORIGINAL raw object after assignment does not notify (proxy is a copy boundary)', () => {
        const raw = { appid: 400, name: 'Portal' }
        store.lastPlayed = raw
        const seen: string[] = []
        const cleanup = $effect.root(() => {
            $effect(() => { seen.push(store.lastPlayed?.name ?? '') })
        })
        flushSync()
        raw.name = 'Half-Life' // stale-closure style mistake: writing to the pre-proxy reference
        flushSync()
        cleanup()
        // Actual Svelte 5 behavior: the raw object is not the proxy; no reaction fires
        // and the store still reads the old value. Callers must write via the store.
        expect(seen).toEqual(['Portal'])
        expect(store.lastPlayed?.name).toBe('Portal')
    })
})
