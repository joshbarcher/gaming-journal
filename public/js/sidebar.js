import { mount } from 'svelte'
import { api } from './api.js'
import Sidebar from '../svelte/sidebar/Sidebar.svelte'
import { store } from '../svelte/sidebar/sidebarStore.svelte.js'

let _nowPlayingTimer = null
let _alertsTimer     = null
let _mounted         = false

export function getPages() {
    return store.pages
}

export async function loadSidebar(activeId, onNavigate) {
    store.navigate = onNavigate
    store.activeId = activeId
    store.pages    = await api.pages.list()

    if (!_mounted) {
        const navEl = document.getElementById('sidebar-nav')
        navEl.innerHTML = ''
        mount(Sidebar, { target: navEl })
        _mounted = true
    }

    _startNowPlayingPoller()
    _startAlertsPoller()
    _fetchCollectionCounts()
    _fetchHistoryBackdrop()
}

export function setActiveItem(id) {
    store.activeId = id
    if (id !== 'toc' && id !== 'home') {
        const page = store.pages.find(p => p.id === id)
        if (page) refreshSidebarItem(page)
    }
}

export function addPageToSidebar(page) {
    store.pages.push(page)
}

export function refreshSidebarItem(updatedPage) {
    const idx = store.pages.findIndex(p => p.id === updatedPage.id)
    if (idx !== -1) store.pages[idx] = updatedPage
}

export function refreshAlertsBadge() {
    _fetchAlertsBadge()
}

export function refreshCollectionCounts() {
    _fetchCollectionCounts()
}

// ── Now Playing ───────────────────────────────────────────────────────────────

function _startNowPlayingPoller() {
    _fetchNowPlaying()
    if (_nowPlayingTimer) clearInterval(_nowPlayingTimer)
    _nowPlayingTimer = setInterval(_fetchNowPlaying, 60_000)
}

async function _fetchNowPlaying() {
    try {
        const res = await fetch('/relay/api/steam/now-playing')
        if (!res.ok) return
        const { playing } = await res.json()
        if (!playing) {
            store.nowPlaying = null
            return
        }
        const elapsed = _fmtElapsed(playing.sessionStartedAt ?? null)
        store.nowPlaying = { ...playing, elapsed }
        store.historyAppid = playing.appid
    } catch { /* silent */ }
}

function _fmtElapsed(startIso) {
    if (!startIso) return ''
    const min = Math.max(1, Math.floor((Date.now() - new Date(startIso).getTime()) / 60_000))
    const h   = Math.floor(min / 60)
    const m   = min % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

// ── Alerts badge ──────────────────────────────────────────────────────────────

function _startAlertsPoller() {
    _fetchAlertsBadge()
    if (_alertsTimer) clearInterval(_alertsTimer)
    _alertsTimer = setInterval(_fetchAlertsBadge, 15 * 60_000)
}

async function _fetchAlertsBadge() {
    try {
        const res = await fetch('/api/alerts')
        if (!res.ok) return
        const { onSale } = await res.json()
        store.alertsCount = onSale?.length ?? 0
    } catch { /* silent */ }
}

// ── Collection counts ─────────────────────────────────────────────────────────

async function _fetchCollectionCounts() {
    try {
        const [flagsRes, accountRes, franchisesRes] = await Promise.all([
            fetch('/api/flags'),
            fetch('/relay/api/account'),
            fetch('/api/franchises'),
        ])
        if (!flagsRes.ok) return
        const flags = await flagsRes.json()
        const counts = { favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, library: 0, wishlist: 0, franchises: 0 }
        for (const f of Object.values(flags)) {
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

// ── History backdrop ──────────────────────────────────────────────────────────

async function _fetchHistoryBackdrop() {
    try {
        const res = await fetch('/relay/api/steam/playtime/last-played')
        if (!res.ok) return
        const map = await res.json()
        const sorted = Object.entries(map)
            .filter(([, v]) => v.lastPlayedAt)
            .sort((a, b) => new Date(b[1].lastPlayedAt) - new Date(a[1].lastPlayedAt))
        if (sorted.length) store.historyAppid = sorted[0][0]
    } catch { /* silent */ }
}
