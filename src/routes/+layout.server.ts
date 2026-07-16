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
        if (!res.ok || res.status === 204) return null
        return await res.json()
    } catch { return null }
}

function fmtElapsed(startIso: string | null): string {
    if (!startIso) return ''
    const min = Math.max(1, Math.floor((Date.now() - new Date(startIso).getTime()) / 60_000))
    const h = Math.floor(min / 60), m = min % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

export async function load() {
    const [flagsResult, pagesResult, franchisesResult, alertsResult, account, playtime, npResult, pinResult, trackerJobsResult] =
        await Promise.allSettled([
            getAllFlags(),
            // async IIFEs, not Promise.resolve(expr): a synchronous throw inside the
            // expression (service not loaded yet / DATA_DIR unset) would escape
            // allSettled entirely and 500 every page instead of degrading.
            (async () => getJournalService().getAll())(),
            (async () => getFranchiseService().getAll())(),
            getAlerts(),
            safeRelayJson('/api/account'),
            safeRelayJson('/api/steam/playtime/last-played'),
            safeRelayJson('/api/steam/now-playing'),
            safeRelayJson('/api/pin'),
            safeRelayJson('/api/progress-suggest/jobs'),
        ])

    const flags      = flagsResult.status      === 'fulfilled' ? flagsResult.value      : {}
    const pages      = pagesResult.status      === 'fulfilled' ? pagesResult.value      : []
    const franchises = franchisesResult.status === 'fulfilled' ? franchisesResult.value : []
    const alerts     = alertsResult.status     === 'fulfilled' ? alertsResult.value     : { onSale: [] }
    const accountData  = account.status   === 'fulfilled' ? account.value   : null
    const playtimeData = playtime.status  === 'fulfilled' ? playtime.value  : null
    const npData       = npResult.status  === 'fulfilled' ? npResult.value  : null
    const pinData      = pinResult.status === 'fulfilled' ? pinResult.value : null
    const trackerJobs  = trackerJobsResult.status === 'fulfilled' && Array.isArray(trackerJobsResult.value)
        ? trackerJobsResult.value : []

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
    // Rotating backdrop list for the Sale Alerts nav item: on-sale games + their cut %.
    const saleAlerts = ((alerts?.onSale ?? []) as { appid: number; bestPrice?: { cut?: number } | null }[])
        .map(a => ({ appid: a.appid, cut: a.bestPrice?.cut ?? 0 }))
        .filter(a => a.cut > 0)

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

    // Now playing — compute elapsed server-side so the card is ready to render immediately
    const playingRaw = npData?.playing ?? null
    const nowPlaying = playingRaw
        ? { ...playingRaw, elapsed: fmtElapsed(playingRaw.sessionStartedAt ?? null) }
        : null

    return {
        counts,
        pages:        pages as Page[],
        alertsCount,
        saleAlerts,
        historyAppid,
        lastPlayed,
        nowPlaying,
        pin:          pinData as PinState | null,
        trackerJobs,
    }
}
