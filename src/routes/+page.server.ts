import { getAlerts } from '$lib/server/services/alertsService.js'
import { getAllFlags } from '$lib/server/services/flagsService.js'
import { getSettings } from '$lib/server/services/settingsService.js'
import type { AlertResult, DiscoverSection, FlagsStore, Settings } from '$lib/types.js'

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

function makeShouldShow(flags: FlagsStore, settings: Settings) {
    return function shouldShow(appid: number | string): boolean {
        const f = flags[String(appid)] ?? {}
        if (f.software)                               return false
        if (f.childLock && !settings.showChildLocked) return false
        if (f.filtered  && !settings.showFiltered)   return false
        return true
    }
}

function sampleDiscover(sections: DiscoverSection[], n: number, shouldShow: (appid: number) => boolean): { header: string }[] {
    const items = sections.flatMap(s => s.items ?? []).filter(item => shouldShow(item.appid))
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

    const [homeData, discoverData, alerts, flags, settings] = await Promise.all([
        fetchJson<RelayHomeData>(`${base}/api/home`),
        fetchJson<DiscoverSection[]>(`${base}/api/discover/featured`),
        getAlerts().catch(() => ({ onSale: [], watching: [] })),
        getAllFlags().catch(() => ({} as FlagsStore)),
        getSettings().catch(() => ({ showChildLocked: false, showFiltered: false, hideUnavailable: false } as Settings)),
    ])

    const shouldShow = makeShouldShow(flags, settings)

    const onSale = alerts.onSale ?? []
    const saleGame = onSale.length
        ? onSale[Math.floor(Math.random() * onSale.length)]
        : null

    return {
        resume:      homeData?.resume     ?? null,
        release:     homeData?.release    ?? null,
        libPosters:  (homeData?.libPosters ?? []).filter(p => shouldShow(p.appid)),
        wlPosters:   (homeData?.wlPosters  ?? []).filter(p => shouldShow(p.appid)),
        discPosters: sampleDiscover(discoverData ?? [], 6, shouldShow),
        saleGame,
    }
}

