import { getAllFlags } from './flagsService.js'
import { ssrRead } from '../ssrData.js'
import { getOne as getOneGame, ensureBuilt as ensureGamesBuilt } from '../relay/games/games.service.js'
import { getEntry as getItadEntry } from '../relay/itad/itad.service.js'
import type { AlertResult, BestPrice, ItadHistoricalLow } from '../../types.js'

interface ItadDeal {
    price: number
    cut:   number
    store: string
    url?:  string
}

interface ItadEntry {
    deals?:         ItadDeal[]
    historicalLow?: ItadHistoricalLow
}

interface GameEntry {
    name?:   string
    source?: string
}

// ── Why this is memoized ──────────────────────────────────────────────────────
// getAlerts runs in the ROOT layout, so it runs on every page of the site. It
// used to do two loopback HTTP calls per alerted game (each on undici's default
// 4s-keepalive pool — see internalFetch.ts) and itad.getEntry is an uncached
// readFile against the NAS. So: a per-page, per-alert fan-out of network+NAS work
// on the critical render path, redoing identical reads every navigation.
//
// Now each game's alert row is memoized individually and served
// stale-while-revalidate. Per-game rather than one blob so that toggling a single
// alert costs one read instead of re-reading the whole set.
const ENTRY_TTL_MS = 5 * 60 * 1_000

const _memo = new Map<number, { value: AlertResult; at: number }>()
let _inflight: Promise<void> | null = null

/** Test hook — the memo is module-level and would otherwise leak between tests
 *  (same convention as nexus _resetCaches / sessions _resetForTests). */
export function _resetForTests(): void {
    _memo.clear()
    _inflight = null
}

async function readOne(appid: number): Promise<AlertResult> {
    const [game, itad] = await Promise.all([
        ssrRead<GameEntry>('games', `/api/games/${appid}`, async () => {
            // Cached read only — the full route also provisions/re-checks store data
            // on view, which a sidebar count must never trigger.
            await ensureGamesBuilt()
            return getOneGame(appid)
        }),
        ssrRead<ItadEntry>('itad', `/api/itad/${appid}`, () => getItadEntry(appid)),
    ])

    const bestDeal = itad?.deals?.[0] ?? null
    const bestPrice: BestPrice | null = bestDeal
        ? { price: bestDeal.price, cut: bestDeal.cut, store: bestDeal.store, url: bestDeal.url ?? null }
        : null

    return {
        appid,
        name:          game?.name          ?? `App ${appid}`,
        bestPrice,
        historicalLow: itad?.historicalLow ?? null,
        isLibrary:     game?.source === 'library' || game?.source === 'both',
    }
}

async function readInto(appids: number[]): Promise<void> {
    await Promise.all(appids.map(async (appid) => {
        // One unreadable entry must not empty the whole sidebar — keep whatever
        // was memoized before and let the next refresh try again.
        try { _memo.set(appid, { value: await readOne(appid), at: Date.now() }) }
        catch { /* keep prior value */ }
    }))
}

/** Refresh every row off the request path. Single-flight: concurrent page loads
 *  that all notice staleness trigger one refresh between them, not one each. */
function refreshInBackground(appids: number[]): Promise<void> {
    if (_inflight) return _inflight
    _inflight = readInto(appids).finally(() => { _inflight = null })
    return _inflight
}

export async function getAlerts(): Promise<{ onSale: AlertResult[]; watching: AlertResult[] }> {
    const allFlags = await getAllFlags()

    const alertAppids = Object.entries(allFlags)
        .filter(([, flags]) => flags.alert)
        .map(([appid]) => Number(appid))

    if (alertAppids.length === 0) return { onSale: [], watching: [] }

    // Never-seen games have to be read now, or a game the user just set an alert on
    // wouldn't show up until some later navigation. It's one small read each, and
    // only on the first page load after the alert is added.
    const unseen = alertAppids.filter(appid => !_memo.has(appid))
    if (unseen.length) await readInto(unseen)

    // Everything else is served from the memo, however old, and refreshed behind
    // the response — a price that updates a moment later beats a stalled render.
    const stale = alertAppids.some(appid => Date.now() - (_memo.get(appid)?.at ?? 0) >= ENTRY_TTL_MS)
    if (stale) refreshInBackground(alertAppids)   // NOT awaited — that's the point

    // Drop rows for games no longer alerted so the memo tracks the flag set.
    if (_memo.size > alertAppids.length) {
        const live = new Set(alertAppids)
        for (const appid of _memo.keys()) if (!live.has(appid)) _memo.delete(appid)
    }

    const results = alertAppids
        .map(appid => _memo.get(appid)?.value)
        .filter((r): r is AlertResult => r != null)

    // watching is the complement of onSale — a weird cut (negative, NaN) must land the
    // game in watching, never make it vanish from both lists.
    const onSale   = results.filter(r => !r.isLibrary && (r.bestPrice?.cut ?? 0) > 0)
    const watching = results.filter(r => !r.isLibrary && !((r.bestPrice?.cut ?? 0) > 0))

    onSale.sort((a, b) => (b.bestPrice?.cut ?? 0) - (a.bestPrice?.cut ?? 0))

    return { onSale, watching }
}
