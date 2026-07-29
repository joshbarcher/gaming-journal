import { getAllFlags }        from '$lib/server/services/flagsService.js'
import { getJournalService }  from '$lib/server/services/journalService.js'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'
import { getAlerts }          from '$lib/server/services/alertsService.js'
import { ssrRead }            from '$lib/server/ssrData.js'
import type { Page, PinState } from '$lib/types.js'

// These read the journal's own gaming data in-process — no loopback socket. See
// ssrData.ts for why (this layout runs on EVERY page, so it was the single
// biggest contributor to the post-idle stall).
import { get as getAccountSnapshot, ensureBuilt as ensureAccountBuilt } from '$lib/server/relay/account/account.service.js'
import { load as loadPlayLog, getLastPlayedMap }                       from '$lib/server/relay/steam/play-log.service.js'
import { get as getNowPlaying }                                        from '$lib/server/relay/steam/now-playing.service.js'
import { get as getPin }                                               from '$lib/server/relay/pin/pin.service.js'
import { getJobs as getTrackerJobs }                                   from '$lib/server/relay/progress-suggest/suggest-job-queue.js'
import { getOne as getOneGame, ensureBuilt as ensureGamesBuilt }       from '$lib/server/relay/games/games.service.js'

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
            ssrRead('account', '/api/account', async () => {
                await loadPlayLog()
                await ensureAccountBuilt()
                return getAccountSnapshot()
            }),
            ssrRead('sessions', '/api/steam/playtime/last-played', async () => {
                await loadPlayLog()
                return getLastPlayedMap()
            }),
            ssrRead('now-playing', '/api/steam/now-playing', () => getNowPlaying()),
            ssrRead('pin', '/api/pin', () => getPin()),
            ssrRead('progress-suggest', '/api/progress-suggest/jobs', () => getTrackerJobs()),
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
    const counts = { favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, playlist: 0, library: 0, wishlist: 0, franchises: 0 }
    for (const f of Object.values(flags as any)) {
        if ((f as any).favorite)   counts.favorites++
        if ((f as any).inProgress) counts.inProgress++
        if ((f as any).backlog)    counts.backlog++
        if ((f as any).dropped)    counts.dropped++
        if ((f as any).completed)  counts.completed++
        if ((f as any).playlist)   counts.playlist++
    }
    counts.library    = accountData?.stats?.totalGames    ?? 0
    counts.wishlist   = accountData?.stats?.wishlistCount ?? 0
    counts.franchises = Array.isArray(franchises) ? (franchises as unknown[]).length : 0

    const alertsCount = (alerts?.onSale?.length ?? 0) as number
    // Rotating backdrop list for the Sale Alerts nav item: on-sale games + their cut %.
    const saleAlerts = ((alerts?.onSale ?? []) as { appid: number; bestPrice?: { cut?: number } | null }[])
        .map(a => ({ appid: a.appid, cut: a.bestPrice?.cut ?? 0 }))
        .filter(a => a.cut > 0)

    // History backdrop: most-recently-played game. Single pass for the max — this
    // runs on every page, and sorting the whole map to read one element is work
    // we pay per request for nothing.
    let historyAppid: number | null = null
    let lastPlayed: { appid: number; name: string } | null = null
    if (playtimeData) {
        let bestMs = -Infinity
        for (const [appid, v] of Object.entries(playtimeData as Record<string, any>)) {
            if (!v?.lastPlayedAt) continue
            const ms = new Date(v.lastPlayedAt).getTime()
            if (!Number.isFinite(ms) || ms <= bestMs) continue
            bestMs = ms
            historyAppid = Number(appid)
        }
        if (historyAppid !== null) {
            // Cached read only. The full /api/games/:appid route also provisions and
            // re-checks store data on view; a nav backdrop label must not trigger
            // that, and it was a SECOND serial round-trip after the batch above.
            const game = await ssrRead('games', `/api/games/${historyAppid}`, async () => {
                await ensureGamesBuilt()
                return getOneGame(historyAppid)
            })
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
