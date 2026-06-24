<script lang="ts">
    import { onMount } from 'svelte'
    import { afterNavigate, beforeNavigate } from '$app/navigation'
    import Sidebar from '$lib/Sidebar.svelte'
    import GlobalSearch from '$lib/svelte/GlobalSearch.svelte'
    import { store } from '$lib/sidebar.svelte.js'
    import { jobStore } from '$lib/guide-jobs.svelte.js'

    const { children } = $props()

    let sidebarOpen  = $state(false)
    let searchOpen   = $state(false)

    afterNavigate(() => { sidebarOpen = false; searchOpen = false })

    beforeNavigate(({ to, from }) => {
        if (!to || !from) return
        const toSeg   = to.url.pathname.split('/')[1]
        const fromSeg = from.url.pathname.split('/')[1]
        if (toSeg === 'game' && fromSeg && fromSeg !== 'game' && fromSeg !== 'community') {
            sessionStorage.setItem('gj_game_from', fromSeg)
        }
    })

    // ── Global search shortcut ────────────────────────────────────────────────
    function onGlobalKeyDown(e: KeyboardEvent) {
        if (e.ctrlKey && e.code === 'Space') {
            e.preventDefault()
            searchOpen = !searchOpen
        }
        if (e.key === 'Escape' && searchOpen) {
            searchOpen = false
        }
    }

    // ── Paste handler ─────────────────────────────────────────────────────────
    function onPaste(e: ClipboardEvent) {
        const target = e.target as HTMLElement | null
        if (!target) return
        if (!target.isContentEditable && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return
        e.preventDefault()
        const text = e.clipboardData?.getData('text/plain') ?? ''
        if (target.isContentEditable) {
            document.execCommand('insertText', false, text)
        } else {
            const inp   = target as HTMLInputElement
            const start = inp.selectionStart ?? 0
            const end   = inp.selectionEnd   ?? 0
            inp.value = inp.value.slice(0, start) + text + inp.value.slice(end)
            inp.selectionStart = inp.selectionEnd = start + text.length
        }
    }

    // ── Polling helpers ───────────────────────────────────────────────────────
    function fmtElapsed(startIso: string | null | undefined): string {
        if (!startIso) return ''
        const min = Math.max(1, Math.floor((Date.now() - new Date(startIso).getTime()) / 60_000))
        const h = Math.floor(min / 60)
        const m = min % 60
        if (h === 0) return `${m}m`
        if (m === 0) return `${h}h`
        return `${h}h ${m}m`
    }

    async function fetchNowPlaying() {
        try {
            const res = await fetch('/relay/api/steam/now-playing')
            if (!res.ok) return
            const { playing } = await res.json()
            if (!playing) {
                if (store.nowPlaying) {
                    store.lastPlayed = { appid: store.nowPlaying.appid, name: store.nowPlaying.name }
                }
                store.nowPlaying = null
                return
            }
            store.nowPlaying = { ...playing, elapsed: fmtElapsed(playing.sessionStartedAt ?? null) }
            store.historyAppid = playing.appid
        } catch { /* silent */ }
    }

    async function fetchPin() {
        try {
            const res = await fetch('/relay/api/pin')
            store.pin = res.status === 204 ? null : (res.ok ? await res.json() : store.pin)
        } catch { /* silent */ }
    }

    async function fetchAlertsBadge() {
        try {
            const res = await fetch('/api/alerts')
            if (!res.ok) return
            const { onSale } = await res.json()
            store.alertsCount = onSale?.length ?? 0
        } catch { /* silent */ }
    }

    async function fetchCollectionCounts() {
        try {
            const [flagsRes, accountRes, franchisesRes] = await Promise.all([
                fetch('/api/flags'),
                fetch('/relay/api/account'),
                fetch('/api/franchises'),
            ])
            if (!flagsRes.ok) return
            const flags = await flagsRes.json()
            const counts = { favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, library: 0, wishlist: 0, franchises: 0 }
            for (const f of Object.values(flags) as any[]) {
                if (f.favorite)   counts.favorites++
                if (f.inProgress) counts.inProgress++
                if (f.backlog)    counts.backlog++
                if (f.dropped)    counts.dropped++
                if (f.completed)  counts.completed++
            }
            if (accountRes.ok) {
                const account = await accountRes.json()
                counts.library  = account?.stats?.totalGames   ?? 0
                counts.wishlist = account?.stats?.wishlistCount ?? 0
            }
            if (franchisesRes.ok) {
                const franchises = await franchisesRes.json()
                counts.franchises = Array.isArray(franchises) ? franchises.length : 0
            }
            store.counts = counts
        } catch { /* silent */ }
    }

    async function fetchHistoryBackdrop() {
        try {
            const res = await fetch('/relay/api/steam/playtime/last-played')
            if (!res.ok) return
            const map = await res.json()
            const sorted = Object.entries(map as Record<string, any>)
                .filter(([, v]) => v.lastPlayedAt)
                .sort((a, b) => new Date(b[1].lastPlayedAt).getTime() - new Date(a[1].lastPlayedAt).getTime())
            if (!sorted.length) return
            const appid = Number(sorted[0][0])
            store.historyAppid = appid
            if (!store.nowPlaying && !store.lastPlayed) {
                const gameRes = await fetch(`/relay/api/games/${appid}`)
                if (gameRes.ok) {
                    const game = await gameRes.json()
                    if (game?.name) store.lastPlayed = { appid, name: game.name }
                }
            }
        } catch { /* silent */ }
    }

    // ── Mount ─────────────────────────────────────────────────────────────────
    onMount(() => {
        fetch('/api/pages')
            .then(r => r.ok ? r.json() : [])
            .then(pages => { store.pages = pages })
            .catch(() => {})

        fetchNowPlaying()
        fetchPin()
        const nowPlayingTimer = setInterval(() => { fetchNowPlaying(); fetchPin() }, 60_000)

        fetchAlertsBadge()
        const alertsTimer = setInterval(fetchAlertsBadge, 15 * 60_000)

        fetchCollectionCounts()
        fetchHistoryBackdrop()

        jobStore.connect()

        return () => {
            clearInterval(nowPlayingTimer)
            clearInterval(alertsTimer)
            jobStore.disconnect()
        }
    })
</script>

<svelte:window onpaste={onPaste} onkeydown={onGlobalKeyDown} />

{#if searchOpen}
    <GlobalSearch onclose={() => searchOpen = false} />
{/if}

<button id="sidebar-toggle" class="sidebar-toggle"
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={sidebarOpen}
        onclick={() => sidebarOpen = !sidebarOpen}>
    {#if sidebarOpen}
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
    {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
    {/if}
</button>
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div id="sidebar-overlay" class="sidebar-overlay"
     class:visible={sidebarOpen}
     onclick={() => sidebarOpen = false}></div>
<div id="app">
    <aside id="sidebar" class:sidebar--open={sidebarOpen}>
        <Sidebar />
    </aside>
    <main id="main-content">
        {@render children()}
    </main>
</div>
