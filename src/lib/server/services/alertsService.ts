import { getAllFlags } from './flagsService.js'
import type { AlertResult, BestPrice, ItadHistoricalLow } from '../../types.js'

function relayUrl(): string {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url)
        // await inside the try — an un-awaited res.json() rejection (malformed body)
        // would escape the catch and take down the caller's whole Promise.all.
        return res.ok ? await (res.json() as Promise<T>) : null
    } catch {
        return null
    }
}

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

export async function getAlerts(): Promise<{ onSale: AlertResult[]; watching: AlertResult[] }> {
    const allFlags = await getAllFlags()

    const alertAppids = Object.entries(allFlags)
        .filter(([, flags]) => flags.alert)
        .map(([appid]) => Number(appid))

    if (alertAppids.length === 0) return { onSale: [], watching: [] }

    const base = relayUrl()

    const results = await Promise.all(
        alertAppids.map(async (appid): Promise<AlertResult> => {
            const [game, itad] = await Promise.all([
                fetchJson<GameEntry>(`${base}/api/games/${appid}`),
                fetchJson<ItadEntry>(`${base}/api/itad/${appid}`),
            ])

            const bestDeal   = itad?.deals?.[0] ?? null
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
        })
    )

    // watching is the complement of onSale — a weird cut (negative, NaN) must land the
    // game in watching, never make it vanish from both lists.
    const onSale   = results.filter(r => !r.isLibrary && (r.bestPrice?.cut ?? 0) > 0)
    const watching = results.filter(r => !r.isLibrary && !((r.bestPrice?.cut ?? 0) > 0))

    onSale.sort((a, b) => (b.bestPrice?.cut ?? 0) - (a.bestPrice?.cut ?? 0))

    return { onSale, watching }
}
