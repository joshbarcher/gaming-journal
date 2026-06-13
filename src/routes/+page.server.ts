import { getAlerts } from '$lib/server/services/alertsService.js'
import type { AlertResult, DiscoverSection } from '$lib/types.js'

interface HomePoster  { appid: number; header: string }
interface HomeResume  { appid: number; name: string; header: string; hours: number; daysAgo: number }
interface HomeRelease { appid: number; name: string; header: string }

interface RelayHomeData {
    resume:     HomeResume  | null
    release:    HomeRelease | null
    libPosters: HomePoster[]
    wlPosters:  HomePoster[]
}

export interface HomeData {
    resume:     HomeResume  | null
    release:    HomeRelease | null
    libPosters: HomePoster[]
    wlPosters:  HomePoster[]
    discPosters: { header: string }[]
    saleGame:   AlertResult | null
}

function relayUrl(): string {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url)
        return res.ok ? (res.json() as Promise<T>) : null
    } catch {
        return null
    }
}

function sampleDiscover(sections: DiscoverSection[], n: number): { header: string }[] {
    const items = sections.flatMap(s => s.items ?? [])
    if (!items.length) return []
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy.slice(0, n).map(item => ({
        header: item.headerImage ?? item.posterImage ?? '',
    }))
}

export async function load(): Promise<HomeData> {
    const base = relayUrl()

    const [homeData, discoverData, alerts] = await Promise.all([
        fetchJson<RelayHomeData>(`${base}/api/home`),
        fetchJson<DiscoverSection[]>(`${base}/api/discover/featured`),
        getAlerts().catch(() => ({ onSale: [], watching: [] })),
    ])

    const onSale = alerts.onSale ?? []
    const saleGame = onSale.length
        ? onSale[Math.floor(Math.random() * onSale.length)]
        : null

    return {
        resume:      homeData?.resume     ?? null,
        release:     homeData?.release    ?? null,
        libPosters:  homeData?.libPosters ?? [],
        wlPosters:   homeData?.wlPosters  ?? [],
        discPosters: sampleDiscover(discoverData ?? [], 6),
        saleGame,
    }
}

