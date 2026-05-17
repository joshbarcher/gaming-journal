import { getAllFlags } from './flagsService.js'

function relayUrl() {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

async function fetchJson(url) {
    try {
        const res = await fetch(url)
        return res.ok ? res.json() : null
    } catch {
        return null
    }
}

export async function getAlerts() {
    const allFlags = await getAllFlags()

    const alertAppids = Object.entries(allFlags)
        .filter(([, flags]) => flags.alert)
        .map(([appid]) => Number(appid))

    if (alertAppids.length === 0) return { onSale: [], watching: [] }

    const base = relayUrl()

    const results = await Promise.all(
        alertAppids.map(async (appid) => {
            const [game, itad] = await Promise.all([
                fetchJson(`${base}/api/games/${appid}`),
                fetchJson(`${base}/api/itad/${appid}`),
            ])
            return {
                appid,
                name:          game?.name          ?? `App ${appid}`,
                bestPrice:     itad?.bestPrice      ?? null,
                historicalLow: itad?.historicalLow  ?? null,
            }
        })
    )

    const onSale   = results.filter(r => (r.bestPrice?.cut ?? 0) > 0)
    const watching = results.filter(r => (r.bestPrice?.cut ?? 0) === 0)

    onSale.sort((a, b) => (b.bestPrice?.cut ?? 0) - (a.bestPrice?.cut ?? 0))

    return { onSale, watching }
}
