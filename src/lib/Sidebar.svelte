<script lang="ts">
    import { page } from '$app/state'
    import { store } from '$lib/sidebar.svelte.js'
    import type { NowPlayingInfo } from '$lib/sidebar.svelte.js'

    // ── SVG icons ─────────────────────────────────────────────────────────────
    const ICO = (paths: string) =>
        `<svg class="sidebar-nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

    const ICONS = {
        history:    ICO(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`),
        backlog:    ICO(`<path d="M5 12H3l9-9 9 9h-2"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/><rect x="9" y="12" width="6" height="9"/>`),
        abandoned:  ICO(`<path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M13 3h6"/><path d="M3 9v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-5"/><path d="m9 3 2 2-2 2"/>`),
        myReviews:  ICO(`<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>`),
        hallOfFame: ICO(`<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>`),
        favorites:  ICO(`<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>`),
        franchises: ICO(`<rect x="2" y="7" width="6" height="13" rx="1"/><rect x="9" y="4" width="6" height="16" rx="1"/><rect x="16" y="2" width="6" height="18" rx="1"/>`),
        inProgress: ICO(`<circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>`),
        home:       ICO(`<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`),
        toc:        ICO(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`),
        library:    ICO(`<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>`),
        wishlist:   ICO(`<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`),
        account:    ICO(`<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`),
        calendar:   ICO(`<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><line x1="8" x2="8.01" y1="14" y2="14"/><line x1="12" x2="12.01" y1="14" y2="14"/><line x1="16" x2="16.01" y1="14" y2="14"/>`),
        topGames:   ICO(`<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>`),
        discover:   ICO(`<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>`),
        releases:   ICO(`<path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>`),
        recommend:  ICO(`<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>`),
        settings:   ICO(`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`),
        alerts:     ICO(`<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>`),
    }

    // ── Active item ───────────────────────────────────────────────────────────
    function getActiveId(pathname: string): string | null {
        if (!pathname || pathname === '/') return 'home'
        const seg = pathname.split('/')[1]
        if (!seg) return 'home'
        if (seg === 'game') return 'library'
        if (seg === 'franchise') return 'franchises'
        if (seg === 'recommend') return 'recommend'
        if (seg === 'journal' || seg === 'community') return null
        return seg
    }

    const activeId = $derived(getActiveId(page.url.pathname))

    // ── Keyboard nav ───────────────────────────────────────────────────────────
    let navEl = $state<HTMLElement | null>(null)

    function arrowNav(e: KeyboardEvent) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        const focusable = [...navEl!.querySelectorAll<HTMLElement>('.sidebar-nav-btn')]
        const idx = focusable.indexOf(document.activeElement as HTMLElement)
        if (idx === -1) return
        if (e.key === 'ArrowDown' && idx < focusable.length - 1) focusable[idx + 1].focus()
        if (e.key === 'ArrowUp'   && idx > 0)                    focusable[idx - 1].focus()
    }
</script>

<nav id="sidebar-nav" bind:this={navEl}>
    <!-- Now Playing / Last Session -->
    {#if store.nowPlaying}
        {@const np = store.nowPlaying}
        <div class="now-playing-wrap">
            <a class="now-playing-card" href="/game/{np.appid}">
                <div class="now-playing-bg" style="background-image:url('/relay/images/steam/games/{np.appid}/header.jpg')"></div>
                <div class="now-playing-scrim"></div>
                <div class="now-playing-body">
                    <span class="now-playing-eyebrow">Now Playing</span>
                    <span class="now-playing-title">{np.name}</span>
                    {#if np.elapsed}<span class="now-playing-time">{np.elapsed}</span>{/if}
                </div>
            </a>
            <div class="now-playing-orbit"><div class="now-playing-particle"></div></div>
        </div>
    {:else if store.lastPlayed}
        {@const lp = store.lastPlayed}
        <div class="now-playing-wrap now-playing-wrap--last">
            <a class="now-playing-card" href="/game/{lp.appid}">
                <div class="now-playing-bg" style="background-image:url('/relay/images/steam/games/{lp.appid}/header.jpg')"></div>
                <div class="now-playing-scrim"></div>
                <div class="now-playing-body">
                    <span class="now-playing-eyebrow">Last Session</span>
                    <span class="now-playing-title">{lp.name}</span>
                </div>
            </a>
        </div>
    {/if}

    <!-- Pinned community feed -->
    {#if store.pin}
        {@const p = store.pin}
        {@const isLive = p.reason === 'playing' && p.sessionEndedAt === null}
        <a class="sidebar-pin-strip" href="/community/{p.appid}" title="Pinned community feed — {p.name}">
            <span class="sidebar-pin-dot" class:sidebar-pin-dot--live={isLive}></span>
            <span class="sidebar-pin-text">
                <span class="sidebar-pin-name">{p.name}</span>
                <span class="sidebar-pin-sub">{isLive ? 'Live community' : 'Pinned community'}</span>
            </span>
        </a>
    {/if}

    <!-- Main nav -->
    <a class="sidebar-nav-btn sidebar-home-btn" href="/"
       data-id="home" class:active={activeId === 'home'}
       onkeydown={arrowNav}>
        {@html ICONS.home} Home
    </a>
    <a class="sidebar-nav-btn sidebar-library-btn" href="/library"
       data-id="library" class:active={activeId === 'library'}
       onkeydown={arrowNav}>
        {@html ICONS.library} Steam Library
        {#if store.counts.library > 0}<span class="sidebar-collection-badge">{store.counts.library}</span>{/if}
    </a>
    <a class="sidebar-nav-btn sidebar-wishlist-btn" href="/wishlist"
       data-id="wishlist" class:active={activeId === 'wishlist'}
       onkeydown={arrowNav}>
        {@html ICONS.wishlist} Wishlist
        {#if store.counts.wishlist > 0}<span class="sidebar-collection-badge">{store.counts.wishlist}</span>{/if}
    </a>
    <a class="sidebar-nav-btn sidebar-discover-btn" href="/discover"
       data-id="discover" class:active={activeId === 'discover'}
       onkeydown={arrowNav}>
        {@html ICONS.discover} Discover
    </a>
    <a class="sidebar-nav-btn sidebar-recommend-btn" href="/recommend"
       data-id="recommend" class:active={activeId === 'recommend'}
       onkeydown={arrowNav}>
        {@html ICONS.recommend} Recommend
    </a>
    <a class="sidebar-nav-btn sidebar-alerts-btn" href="/alerts"
       data-id="alerts" class:active={activeId === 'alerts'}
       onkeydown={arrowNav}>
        {@html ICONS.alerts} Sale Alerts
        {#if store.alertsCount > 0}<span class="sidebar-alerts-badge">{store.alertsCount}</span>{/if}
    </a>
    <a class="sidebar-nav-btn sidebar-calendar-btn" href="/calendar"
       data-id="calendar" class:active={activeId === 'calendar' || activeId === 'releases'}
       onkeydown={arrowNav}>
        {@html ICONS.calendar} Calendar
    </a>
    <a class="sidebar-nav-btn sidebar-top-games-btn" href="/top-games"
       data-id="top-games" class:active={activeId === 'top-games'}
       onkeydown={arrowNav}>
        {@html ICONS.topGames} Top Games
    </a>

    <div class="sidebar-bottom-sep"></div>

    <!-- Collection -->
    <a class="sidebar-nav-btn sidebar-history-btn" href="/history"
       data-id="history" class:active={activeId === 'history'}
       onkeydown={arrowNav}>
        {#if store.historyAppid}
            <span class="sidebar-history-backdrop"
                  style="background-image:url('/relay/images/steam/games/{store.historyAppid}/header.jpg')"></span>
        {/if}
        {@html ICONS.history} History
    </a>
    <a class="sidebar-nav-btn sidebar-inprogress-btn" href="/in-progress"
       data-id="in-progress" class:active={activeId === 'in-progress'}
       onkeydown={arrowNav}>
        {@html ICONS.inProgress} In Progress
        {#if store.counts.inProgress > 0}<span class="sidebar-collection-badge">{store.counts.inProgress}</span>{/if}
    </a>
    <a class="sidebar-nav-btn sidebar-backlog-btn" href="/backlog"
       data-id="backlog" class:active={activeId === 'backlog'}
       onkeydown={arrowNav}>
        {@html ICONS.backlog} Backlog
        {#if store.counts.backlog > 0}<span class="sidebar-collection-badge">{store.counts.backlog}</span>{/if}
    </a>
    <a class="sidebar-nav-btn sidebar-favorites-btn" href="/favorites"
       data-id="favorites" class:active={activeId === 'favorites'}
       onkeydown={arrowNav}>
        {@html ICONS.favorites} Favorites
        {#if store.counts.favorites > 0}<span class="sidebar-collection-badge">{store.counts.favorites}</span>{/if}
    </a>
    <a class="sidebar-nav-btn sidebar-abandoned-btn" href="/abandoned"
       data-id="abandoned" class:active={activeId === 'abandoned'}
       onkeydown={arrowNav}>
        {@html ICONS.abandoned} Abandoned
        {#if store.counts.dropped > 0}<span class="sidebar-collection-badge">{store.counts.dropped}</span>{/if}
    </a>
    <a class="sidebar-nav-btn sidebar-hof-btn" href="/hall-of-fame"
       data-id="hall-of-fame" class:active={activeId === 'hall-of-fame'}
       onkeydown={arrowNav}>
        {@html ICONS.hallOfFame} Completed
        {#if store.counts.completed > 0}<span class="sidebar-collection-badge">{store.counts.completed}</span>{/if}
    </a>
    <a class="sidebar-nav-btn sidebar-franchises-btn" href="/franchises"
       data-id="franchises" class:active={activeId === 'franchises'}
       onkeydown={arrowNav}>
        {@html ICONS.franchises} Franchises
        {#if store.counts.franchises > 0}<span class="sidebar-collection-badge">{store.counts.franchises}</span>{/if}
    </a>

    <div class="sidebar-bottom-sep"></div>

    <a class="sidebar-nav-btn sidebar-myreviews-btn" href="/my-reviews"
       data-id="my-reviews" class:active={activeId === 'my-reviews'}
       onkeydown={arrowNav}>
        {@html ICONS.myReviews} My Reviews
    </a>
    <a class="sidebar-nav-btn sidebar-account-btn" href="/account"
       data-id="account" class:active={activeId === 'account'}
       onkeydown={arrowNav}>
        {@html ICONS.account} Account
    </a>
    <a class="sidebar-nav-btn sidebar-settings-btn" href="/settings"
       data-id="settings" class:active={activeId === 'settings'}
       onkeydown={arrowNav}>
        {@html ICONS.settings} Settings
    </a>

</nav>
