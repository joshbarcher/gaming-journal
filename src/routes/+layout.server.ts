import { getAllFlags }        from '$lib/server/services/flagsService.js'
import { getJournalService }  from '$lib/server/services/journalService.js'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'
import { getAlerts }          from '$lib/server/services/alertsService.js'
import type { Page, PinState } from '$lib/types.js'

function relayBase(): string {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

async function safeRelayJson(path: string): Promise<any> {
    try {
        const res = await fetch(`${relayBase()}${path}`)
        return res.ok ? res.json() : null
    } catch { return null }
}

export async function load() {
    const [flagsResult, pagesResult, franchisesResult, alertsResult, account, playtime] =
        await Promise.allSettled([
            getAllFlags(),
            Promise.resolve(getJournalService().getAll()),
            Promise.resolve(getFranchiseService().getAll()),
            getAlerts(),
            safeRelayJson('/api/account'),
            safeRelayJson('/api/steam/playtime/last-played'),
        ])

    const flags      = flagsResult.status      === 'fulfilled' ? flagsResult.value      : {}
    const pages      = pagesResult.status      === 'fulfilled' ? pagesResult.value      : []
    const franchises = franchisesResult.status === 'fulfilled' ? franchisesResult.value : []
    const alerts     = alertsResult.status     === 'fulfilled' ? alertsResult.value     : { onSale: [] }
    const accountData   = account.status   === 'fulfilled' ? account.value   : null
    const playtimeData  = playtime.status  === 'fulfilled' ? playtime.value  : null

    // Collection counts
    const counts = { favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, library: 0, wishlist: 0, franchises: 0 }
    for (const f of Object.values(flags as any)) {
        if ((f as any).favorite)   counts.favorites++
        if ((f as any).inProgress) counts.inProgress++
        if ((f as any).backlog)    counts.backlog++
        if ((f as any).dropped)    counts.dropped++
        if ((f as any).completed)  counts.completed++
    }
    counts.library    = accountData?.stats?.totalGames    ?? 0
    counts.wishlist   = accountData?.stats?.wishlistCount ?? 0
    counts.franchises = Array.isArray(franchises) ? (franchises as unknown[]).length : 0

    const alertsCount = (alerts?.onSale?.length ?? 0) as number

    // History backdrop: find most-recently-played game
    let historyAppid: number | null = null
    let lastPlayed: { appid: number; name: string } | null = null
    if (playtimeData) {
        const sorted = Object.entries(playtimeData as Record<string, any>)
            .filter(([, v]) => v.lastPlayedAt)
            .sort((a, b) => new Date(b[1].lastPlayedAt).getTime() - new Date(a[1].lastPlayedAt).getTime())
        if (sorted.length) {
            historyAppid = Number(sorted[0][0])
            const game = await safeRelayJson(`/api/games/${historyAppid}`)
            if (game?.name) lastPlayed = { appid: historyAppid, name: game.name }
        }
    }

    return {
        counts,
        pages:        pages as Page[],
        alertsCount,
        historyAppid,
        lastPlayed,
    }
}
