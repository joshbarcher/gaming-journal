<script lang="ts">
    import { onMount } from 'svelte'
    import { afterNavigate, beforeNavigate } from '$app/navigation'
    import Sidebar from '$lib/Sidebar.svelte'
    import GlobalSearch from '$lib/svelte/GlobalSearch.svelte'
    import { store, type NowPlayingInfo } from '$lib/sidebar.svelte.js'
    import { scrollbar } from '$lib/actions/scrollbar.js'
    import { onGameCardContextMenu } from '$lib/js/views/game-card-menu.js'

    const { children, data } = $props()

    let sidebarCollapsed = $state(false)
    let searchOpen       = $state(false)

    function toggleCollapse() {
        sidebarCollapsed = !sidebarCollapsed
        localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed))
    }

    afterNavigate(() => { store.appSidebarOpen = false; searchOpen = false })

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

    // ── Elapsed formatter (for now-playing display) ───────────────────────────
    function fmtElapsed(startIso: string | null): string {
        if (!startIso) return ''
        const min = Math.max(1, Math.floor((Date.now() - new Date(startIso).getTime()) / 60_000))
        const h = Math.floor(min / 60), m = min % 60
        if (h === 0) return `${m}m`
        if (m === 0) return `${h}h`
        return `${h}h ${m}m`
    }

    // ── Mount ─────────────────────────────────────────────────────────────────
    onMount(() => {
        sidebarCollapsed = localStorage.getItem('sidebar-collapsed') === 'true'

        // BroadcastChannel — defined first so applyNowPlaying is available for seeding
        const channel = new BroadcastChannel('sidebar-poll')
        let prevNowPlaying: { appid: number; name: string } | null = null

        function applyNowPlaying(nowPlaying: NowPlayingInfo | null) {
            if (prevNowPlaying && !nowPlaying) store.lastPlayed = prevNowPlaying
            prevNowPlaying = nowPlaying ? { appid: nowPlaying.appid, name: nowPlaying.name } : null
            store.nowPlaying = nowPlaying
        }

        // Seed store from SSR data — nowPlaying and pin arrive with the HTML, no poll needed
        store.pages        = data.pages        ?? []
        store.counts       = data.counts       ?? store.counts
        store.alertsCount  = data.alertsCount  ?? 0
        store.historyAppid = data.historyAppid ?? null
        store.lastPlayed   = data.lastPlayed   ?? null
        applyNowPlaying((data.nowPlaying ?? null) as NowPlayingInfo | null)
        store.pin = (data.pin ?? null)

        // Alerts refresh every 15 min
        const alertsTimer = setInterval(async () => {
            try {
                const res = await fetch('/api/alerts')
                if (!res.ok) return
                const { onSale } = await res.json()
                store.alertsCount = onSale?.length ?? 0
            } catch { /* silent */ }
        }, 15 * 60_000)

        channel.onmessage = ({ data: msg }) => {
            applyNowPlaying(msg.nowPlaying ?? null)
            store.pin = msg.pin ?? null
        }

        let polling = false
        async function poll() {
            if (polling) return
            polling = true
            try {
                const [npRes, pinRes] = await Promise.all([
                    fetch('/relay/api/steam/now-playing'),
                    fetch('/relay/api/pin'),
                ])
                let nowPlaying: NowPlayingInfo | null = null
                if (npRes.ok) {
                    const { playing } = await npRes.json()
                    if (playing) nowPlaying = { ...playing, elapsed: fmtElapsed(playing.sessionStartedAt ?? null) }
                }
                let pin = null
                if (pinRes.ok && pinRes.status !== 204) pin = await pinRes.json()
                applyNowPlaying(nowPlaying)
                store.pin = pin
                channel.postMessage({ nowPlaying, pin })
                localStorage.setItem('sidebar_last_poll', String(Date.now()))
            } catch { /* silent */ }
            finally { polling = false }
        }

        async function maybePoll() {
            const last = Number(localStorage.getItem('sidebar_last_poll') ?? 0)
            if (Date.now() - last < 60_000) return
            await poll()
        }

        function onVisibilityChange() {
            if (document.hidden) return
            const last = Number(localStorage.getItem('sidebar_last_poll') ?? 0)
            if (Date.now() - last > 15_000) poll()
        }

        document.addEventListener('visibilitychange', onVisibilityChange)
        const pollTimer = setInterval(maybePoll, 60_000)
        maybePoll()

        return () => {
            clearInterval(alertsTimer)
            clearInterval(pollTimer)
            channel.close()
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    })
</script>

<svelte:window onpaste={onPaste} onkeydown={onGlobalKeyDown} oncontextmenu={onGameCardContextMenu} />

{#if searchOpen}
    <GlobalSearch onclose={() => searchOpen = false} />
{/if}

<button id="sidebar-toggle" class="sidebar-toggle"
        aria-label={store.appSidebarOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={store.appSidebarOpen}
        onclick={() => store.appSidebarOpen = !store.appSidebarOpen}>
    {#if store.appSidebarOpen}
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
     class:visible={store.appSidebarOpen}
     onclick={() => store.appSidebarOpen = false}></div>
<div id="app">
    <aside id="sidebar" class:sidebar--open={store.appSidebarOpen} class:sidebar--collapsed={sidebarCollapsed}>
        <Sidebar collapsed={sidebarCollapsed} />
        <button class="sidebar-gutter-btn" onclick={toggleCollapse}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {#if sidebarCollapsed}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>
                </svg>
            {:else}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>
                </svg>
            {/if}
        </button>
    </aside>
    <main id="main-content" use:scrollbar>
        {@render children()}
    </main>
</div>
