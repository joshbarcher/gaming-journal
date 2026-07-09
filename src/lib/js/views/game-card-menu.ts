import { goto } from '$app/navigation'
import { showContextMenu, type ContextMenuItem } from './context-menu.js'
import { GAME_SECTIONS } from '../game-sections.js'
import { steamStoreUrl } from '../utils.js'
import type { ItadData, ItadDeal } from '../../types.js'

const HIDDEN_STORES = new Set(['gamesplanet uk', 'gamesplanet fr', 'gamesplanet de']) // mirrors ItadPrices.svelte

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
            label:  `${GUIDE_SOURCE_LABELS[g.source] ?? g.source} — ${g.title}`,
            action: () => goto(`/journal/${appid}/guides/${g.source}/${g.guideId}`),
        }))
    } catch {
        return [{ label: 'Failed to load guides', disabled: true }]
    }
}

function buildGameCardMenu(appid: number): ContextMenuItem[] {
    const items: ContextMenuItem[] = []

    items.push({
        label:   'Game info page',
        submenu: GAME_SECTIONS.map(s => ({ label: s.label, action: () => goto(`/game/${appid}#${s.id}`) })),
    })
    items.push({ label: 'Steam page', external: true, action: () => openExternal(steamStoreUrl(appid)) })
    items.push({ label: 'ITAD', submenu: () => loadItadSubmenu(appid) })
    items.push({ label: 'Journal page', action: () => goto(`/journal/${appid}`) })
    items.push({ label: 'Community page', action: () => goto(`/community/${appid}`) })
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
