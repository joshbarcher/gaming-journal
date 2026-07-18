import { showContextMenu, type ContextMenuItem } from './context-menu.js'
import { GAME_SECTIONS } from '../game-sections.js'
import { steamStoreUrl } from '../utils.js'
import { refreshAlertsBadge } from '../sidebar.js'
import type { ItadData, ItadDeal, Flags, FlagKey } from '../../types.js'

const HIDDEN_STORES = new Set(['gamesplanet uk', 'gamesplanet fr', 'gamesplanet de']) // mirrors ItadPrices.svelte

// Toggle groups mirror FlagsBar.svelte's own grouping so the two surfaces stay conceptually aligned.
const STATUS_FLAGS: { key: FlagKey; label: string }[] = [
    { key: 'backlog',    label: 'Backlog' },
    { key: 'inProgress', label: 'In Progress' },
    { key: 'completed',  label: 'Completed' },
    { key: 'dropped',    label: 'Dropped' },
    { key: 'revisit',    label: 'Revisit' },
]
const VISIBILITY_FLAGS: { key: FlagKey; label: string }[] = [
    { key: 'childLock', label: 'Hide (Child Lock)' },
    { key: 'filtered',  label: 'Filter' },
    { key: 'software',  label: 'Software / Tool' },
]

interface CardState { flags: Flags; wishlisted: boolean }

// Load the game's current flag + local-wishlist state once per open menu. The resolved object is
// mutated in place by the toggle handlers so reopening a submenu reflects changes made this session.
function loadCardState(appid: number): Promise<CardState> {
    const flagsP = fetch(`/api/flags/${appid}`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
    const wlP    = fetch(`/api/local-wishlist/${appid}`).then(r => r.ok ? r.json() : { wishlisted: false }).catch(() => ({ wishlisted: false }))
    return Promise.all([flagsP, wlP]).then(([f, w]) => ({
        flags:      (f ?? {}) as Flags,
        wishlisted: !!(w as { wishlisted?: boolean }).wishlisted,
    }))
}

async function patchFlag(appid: number, flag: FlagKey, value: boolean): Promise<void> {
    const res = await fetch(`/api/flags/${appid}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ flag, value }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (flag === 'alert') refreshAlertsBadge()
}

async function setWishlist(appid: number, wishlisted: boolean): Promise<void> {
    const res = await fetch(`/api/local-wishlist/${appid}`, { method: wishlisted ? 'POST' : 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

function flagItem(appid: number, def: { key: FlagKey; label: string }, st: CardState): ContextMenuItem {
    return {
        label:   def.label,
        checked: !!st.flags[def.key],
        action:  async (next?: boolean) => {
            const value = next ?? !st.flags[def.key]
            await patchFlag(appid, def.key, value)
            st.flags[def.key] = value
        },
    }
}

const GUIDE_SOURCE_LABELS: Record<string, string> = {
    gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8',
    gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker', thegamer: 'TheGamer',
}

interface DownloadedGuide {
    source:     string
    guideId:    string
    title:      string
    parsedAt:   string | null
    lastUsedAt: string | null
}

function openExternal(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer')
}

function dealLabel(prefix: string, d: ItadDeal): string {
    const price = d.price === 0 ? 'Free' : `$${d.price.toFixed(2)}`
    const cut = d.cut > 0 ? ` (-${d.cut}%)` : ''
    return prefix.toLowerCase() === d.store.toLowerCase() ? `${d.store} — ${price}${cut}` : `${prefix}: ${d.store} — ${price}${cut}`
}

async function loadItadSubmenu(appid: number): Promise<ContextMenuItem[]> {
    try {
        const res = await fetch(`/relay/api/itad/${appid}`)
        const itad: ItadData | null = res.ok ? await res.json() : null
        const deals = (itad?.deals ?? []).filter(d => !HIDDEN_STORES.has(d.store.toLowerCase()))
        if (!deals.length) return [{ label: 'No price data available', disabled: true }]

        const items: ContextMenuItem[] = []
        items.push({ label: dealLabel('Best Price', deals[0]), external: true, action: () => openExternal(deals[0].url) })

        const steamIdx = deals.findIndex(d => d.store.toLowerCase() === 'steam')
        if (steamIdx > 0) {
            items.push({ label: dealLabel('Steam', deals[steamIdx]), external: true, action: () => openExternal(deals[steamIdx].url) })
        }
        const shownIdx = new Set([0, steamIdx > 0 ? steamIdx : -1])
        const rest = deals.filter((_, i) => !shownIdx.has(i))
        if (rest.length) {
            items.push('separator')
            for (const d of rest) items.push({ label: dealLabel(d.store, d), external: true, action: () => openExternal(d.url) })
        }
        return items
    } catch {
        return [{ label: 'Failed to load prices', disabled: true }]
    }
}

async function loadGuidesSubmenu(appid: number): Promise<ContextMenuItem[]> {
    try {
        const res = await fetch(`/relay/api/guides/${appid}`)
        const guides: DownloadedGuide[] = res.ok ? await res.json() : []
        if (!guides.length) return [{ label: 'No guides downloaded', disabled: true }]

        const sorted = [...guides].sort((a, b) => {
            const la = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0
            const lb = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0
            if (la !== lb) return lb - la
            return new Date(b.parsedAt ?? 0).getTime() - new Date(a.parsedAt ?? 0).getTime()
        })
        return sorted.map(g => ({
            label: `${GUIDE_SOURCE_LABELS[g.source] ?? g.source} — ${g.title}`,
            href:  `/journal/${appid}/guides/${g.source}/${g.guideId}`,
        }))
    } catch {
        return [{ label: 'Failed to load guides', disabled: true }]
    }
}

function buildGameCardMenu(appid: number): ContextMenuItem[] {
    // Fetch flag/wishlist state lazily on the first toggle submenu the user opens, then reuse it.
    let stateP: Promise<CardState> | null = null
    const getState = () => (stateP ??= loadCardState(appid))

    const items: ContextMenuItem[] = []

    items.push({
        label:   'Play status',
        submenu: async () => {
            const st = await getState()
            return STATUS_FLAGS.map(def => flagItem(appid, def, st))
        },
    })
    items.push({
        label:   'Lists & alerts',
        submenu: async () => {
            const st = await getState()
            return [
                flagItem(appid, { key: 'favorite', label: 'Favorite' }, st),
                {
                    label:   'Wishlist',
                    checked: st.wishlisted,
                    action:  async (next?: boolean) => {
                        const value = next ?? !st.wishlisted
                        await setWishlist(appid, value)
                        st.wishlisted = value
                    },
                },
                flagItem(appid, { key: 'alert', label: 'Sale Alert' }, st),
            ]
        },
    })
    items.push({
        label:   'Visibility',
        submenu: async () => {
            const st = await getState()
            return VISIBILITY_FLAGS.map(def => flagItem(appid, def, st))
        },
    })
    items.push('separator')

    items.push({
        label:   'Game info page',
        submenu: GAME_SECTIONS.map(s => ({ label: s.label, href: `/game/${appid}#${s.id}` })),
    })
    items.push({ label: 'Steam page', external: true, action: () => openExternal(steamStoreUrl(appid)) })
    items.push({ label: 'ITAD', submenu: () => loadItadSubmenu(appid) })
    items.push({ label: 'Journal page', href: `/journal/${appid}` })
    items.push({ label: 'Community page', href: `/community/${appid}` })
    items.push({ label: 'Game guides', submenu: () => loadGuidesSubmenu(appid) })
    return items
}

export function onGameCardContextMenu(e: MouseEvent): void {
    const target = e.target as Element | null
    const card = target?.closest?.('[data-game-card]') as HTMLElement | null
    if (!card) return
    const appid = Number(card.dataset.appid)
    if (!appid) return
    showContextMenu(e, buildGameCardMenu(appid))
}
