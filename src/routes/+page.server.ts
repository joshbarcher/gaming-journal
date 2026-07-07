import { getAlerts } from '$lib/server/services/alertsService.js'
import { getAllFlags } from '$lib/server/services/flagsService.js'
import { getSettings } from '$lib/server/services/settingsService.js'
import { getAllLocalReviews } from '$lib/server/services/localReviewsService.js'
import type { AlertResult, DiscoverSection, FlagsStore, Settings } from '$lib/types.js'

interface HomePoster  { appid: number; poster: string }

interface AchievementProgress { unlocked: number; total: number }

interface HomeResume  { appid: number; name: string; header: string; hours: number; daysAgo: number }
interface RecentPlayed {
    appid:        number
    name:         string
    header:       string
    hours:        number
    daysAgo:      number
    achievements: AchievementProgress | null
}
interface JustBought  { appid: number; name: string; header: string; daysAgo: number }
interface HomeRelease { appid: number; name: string; header: string }
interface RelayStats  { hours: number; achievements: number; added: number; wishlisted: number }

interface RelayHomeData {
    resume:       HomeResume  | null
    recentPlayed: RecentPlayed[]
    justBought:   JustBought[]
    stats:        RelayStats
    release:      HomeRelease | null
    libPosters:   HomePoster[]
    wlPosters:    HomePoster[]
}

interface GuideListEntry { source: string; guideId: string; title: string; lastUsedAt: string | null }

// ── Card shapes handed to the client ───────────────────────────────────────────

export type SessionCard = RecentPlayed

export type SaleCard =
    | { kind: 'sale';     appid: number; name: string; header: string; cut: number; price: string; store: string; url: string; external: boolean }
    | { kind: 'waiting';  appid: number; name: string; header: string }
    | { kind: 'wishlist'; appid: number; name: string; header: string }

export type MiddleCard =
    | { kind: 'release'; appid: number; name: string; header: string }
    | { kind: 'bought';  appid: number; name: string; header: string; daysAgo: number }
    | { kind: 'guide';   appid: number; name: string; header: string; source: string; guideId: string; title: string }
    | { kind: 'stats';   hours: number; achievements: number; ratings: number; added: number; wishlisted: number }

export interface HomeData {
    session:     SessionCard | null
    middle:      MiddleCard
    saleGame:    Promise<SaleCard | null>
    libPosters:  HomePoster[]
    wlPosters:   HomePoster[]
    discPosters: HomePoster[]
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

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

function pick<T>(arr: T[]): T | null {
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null
}

function sampleDiscover(sections: DiscoverSection[], n: number, shouldShow: (appid: number) => boolean, titleBlocklist: string[] = [], hideAdultContent = true): HomePoster[] {
    const blocked = titleBlocklist.map(t => t.toLowerCase())
    const items = sections.flatMap(s => s.items ?? []).filter(item => {
        if (!shouldShow(item.appid)) return false
        if (hideAdultContent && item.isAdult) return false
        if (blocked.length) {
            const lower = item.name.toLowerCase()
            if (blocked.some(t => lower.includes(t))) return false
        }
        return true
    })
    if (!items.length) return []
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy.slice(0, n).map(item => ({ appid: item.appid, poster: item.headerImage ?? '' }))
}

const headerUrl = (appid: number) => `/relay/images/steam/games/${appid}/header.jpg`

/**
 * Sale card, resolved in three tiers so the slot is never empty:
 *   1. a sales-watch game currently discounted        → "On Sale −X%"
 *   2. else a sales-watch game not yet discounted      → "Waiting for sale"
 *   3. else a random wishlist title (no watch at all)  → plain wishlist nudge
 */
async function resolveSale(base: string, wlPosters: HomePoster[], shouldShow: (a: number) => boolean): Promise<SaleCard | null> {
    try {
        const { onSale, watching } = await getAlerts()

        const hit = pick(onSale.filter(a => shouldShow(a.appid)))
        if (hit) {
            const bp = hit.bestPrice
            const url = bp?.url ?? `/game/${hit.appid}`
            return {
                kind:     'sale',
                appid:    hit.appid,
                name:     hit.name,
                header:   headerUrl(hit.appid),
                cut:      bp?.cut ?? 0,
                price:    bp?.price != null ? `$${bp.price.toFixed(2)}` : '',
                store:    bp?.store ?? '',
                url,
                external: url.startsWith('http'),
            }
        }

        const wait = pick(watching.filter(a => shouldShow(a.appid)))
        if (wait) {
            return { kind: 'waiting', appid: wait.appid, name: wait.name, header: headerUrl(wait.appid) }
        }

        // Tier 3 — nothing on the sales watch. Surface a random wishlist title.
        const poster = pick(wlPosters.filter(p => shouldShow(p.appid)))
        if (!poster) return null
        const game = await fetchJson<{ name?: string }>(`${base}/api/games/${poster.appid}`)
        return {
            kind:   'wishlist',
            appid:  poster.appid,
            name:   game?.name ?? `App ${poster.appid}`,
            header: poster.poster || headerUrl(poster.appid),
        }
    } catch {
        return null
    }
}

async function countRecentRatings(): Promise<number> {
    try {
        const reviews = await getAllLocalReviews()
        const cutoff  = Date.now() - THIRTY_DAYS_MS
        return Object.values(reviews).filter(r => r.updatedAt && new Date(r.updatedAt).getTime() >= cutoff).length
    } catch {
        return 0
    }
}

function bestGuide(guides: GuideListEntry[]): GuideListEntry | null {
    if (!guides.length) return null
    return [...guides].sort((a, b) => {
        const ta = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0
        const tb = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0
        return tb - ta
    })[0]
}

/**
 * Middle card, resolved by priority (first match wins):
 *   released today → just bought → guide for the game you're playing → activity stats
 * Stats is the evergreen floor, so the slot is always filled.
 */
async function resolveMiddle(
    base: string,
    relay: RelayHomeData,
    session: SessionCard | null,
    shouldShow: (a: number) => boolean,
): Promise<MiddleCard> {
    const { release, justBought, stats } = relay

    if (release && shouldShow(release.appid)) {
        return { kind: 'release', appid: release.appid, name: release.name, header: release.header }
    }

    const bought = pick(justBought.filter(g => shouldShow(g.appid)))
    if (bought) {
        return { kind: 'bought', appid: bought.appid, name: bought.name, header: bought.header, daysAgo: bought.daysAgo }
    }

    if (session) {
        const guides = await fetchJson<GuideListEntry[]>(`${base}/api/guides/${session.appid}`)
        const guide  = bestGuide(guides ?? [])
        if (guide) {
            return { kind: 'guide', appid: session.appid, name: session.name, header: session.header, source: guide.source, guideId: guide.guideId, title: guide.title }
        }
    }

    const ratings = await countRecentRatings()
    return { kind: 'stats', hours: stats.hours, achievements: stats.achievements, ratings, added: stats.added, wishlisted: stats.wishlisted }
}

export async function load(): Promise<HomeData> {
    const base = relayUrl()

    const [homeData, libPosters, wlPosters, discoverData, flags, settings] = await Promise.all([
        fetchJson<RelayHomeData>(`${base}/api/home`),
        fetchJson<HomePoster[]>(`${base}/api/games/posters?source=library&n=50`),
        fetchJson<HomePoster[]>(`${base}/api/games/posters?source=wishlist&n=50`),
        fetchJson<DiscoverSection[]>(`${base}/api/discover/featured`),
        getAllFlags().catch(() => ({} as FlagsStore)),
        getSettings().catch(() => ({ showChildLocked: false, showFiltered: false, hideUnavailable: false, titleBlocklist: [], discoverFiltersEnabled: true, hideAdultContent: true } as Settings)),
    ])

    const shouldShow = makeShouldShow(flags, settings)

    const relay: RelayHomeData = homeData ?? {
        resume: null, recentPlayed: [], justBought: [], stats: { hours: 0, achievements: 0, added: 0, wishlisted: 0 }, release: null, libPosters: [], wlPosters: [],
    }

    // Session card: the most-recently-played title the filter toggles allow, so a
    // hidden (child-locked / filtered) last game never leaks onto the home page.
    const session = relay.recentPlayed.find(g => shouldShow(g.appid)) ?? null

    const filteredWl = (wlPosters ?? []).filter(p => shouldShow(p.appid))
    const middle     = await resolveMiddle(base, relay, session, shouldShow)

    return {
        session,
        middle,
        saleGame:    resolveSale(base, filteredWl, shouldShow),
        libPosters:  (libPosters ?? []).filter(p => shouldShow(p.appid)),
        wlPosters:   filteredWl,
        discPosters: sampleDiscover(discoverData ?? [], 50, shouldShow, settings.titleBlocklist ?? [], settings.hideAdultContent),
    }
}
