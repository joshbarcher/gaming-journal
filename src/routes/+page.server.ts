import { getAllFlags } from '$lib/server/services/flagsService.js'
import { getSettings } from '$lib/server/services/settingsService.js'
import { journalRelayBase } from '$lib/server/journalRelayBase.js'
import type { DiscoverSection, FlagsStore, Settings } from '$lib/types.js'

interface HomePoster  { appid: number; poster: string }

interface AchievementProgress { unlocked: number; total: number }

interface GuideInfo {
    source:      string
    guideId:     string
    title:       string
    sourceUrl:   string | null
    pageCount:   number
    screenshot:  string | null
    screenshots: string[]
}

interface RecentPlayed {
    appid:        number
    name:         string
    header:       string
    hours:        number
    daysAgo:      number
    achievements: AchievementProgress | null
    guide?:       GuideInfo | null
}
interface JustBought  { appid: number; name: string; header: string; daysAgo: number }
interface HomeRelease { appid: number; name: string; header: string }
interface RelayStats  { hours: number; achievements: number; added: number; wishlisted: number; ratings: number }

interface RelayHomeData {
    recentPlayed: RecentPlayed[]
    justBought:   JustBought[]
    stats:        RelayStats
    release:      HomeRelease | null
    libPosters:   HomePoster[]
    wlPosters:    HomePoster[]
}

// ── Card shapes handed to the client ───────────────────────────────────────────

export type SessionCard = RecentPlayed

export type MiddleCard =
    | { kind: 'release'; appid: number; name: string; header: string }
    | { kind: 'bought';  appid: number; name: string; header: string; daysAgo: number }
    | { kind: 'guide';   appid: number; name: string; header: string; guide: GuideInfo }
    | { kind: 'stats';   hours: number; achievements: number; ratings: number; added: number; wishlisted: number }

export interface HomeData {
    session:     SessionCard | null
    middle:      MiddleCard
    libPosters:  HomePoster[]
    wlPosters:   HomePoster[]
    discPosters: HomePoster[]
}

const EMPTY_RELAY: RelayHomeData = {
    recentPlayed: [], justBought: [], stats: { hours: 0, achievements: 0, added: 0, wishlisted: 0, ratings: 0 },
    release: null, libPosters: [], wlPosters: [],
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url)
        // await inside the try — an un-awaited res.json() rejection (malformed body)
        // would escape the catch and 500 the whole home page via Promise.all.
        return res.ok ? await (res.json() as Promise<T>) : null
    } catch {
        return null
    }
}

function makeShouldShow(flags: FlagsStore, settings: Settings) {
    return function shouldShow(appid: number | string): boolean {
        const f = flags[String(appid)] ?? {}
        if (f.software  && !settings.showSoftware)   return false
        if (f.childLock && !settings.showChildLocked) return false
        if (f.filtered  && !settings.showFiltered)   return false
        return true
    }
}

function pick<T>(arr: T[]): T | null {
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null
}

function sampleDiscover(sections: DiscoverSection[], n: number, shouldShow: (appid: number) => boolean, titleBlocklist: string[] = [], hideAdultContent = true): HomePoster[] {
    // NFKC-normalize both sides so "Pokémon" (NFD) can't slip past an NFC blocklist entry.
    const blocked = titleBlocklist.map(t => t.normalize('NFKC').toLowerCase())
    const items = sections.flatMap(s => s.items ?? []).filter(item => {
        if (!shouldShow(item.appid)) return false
        if (hideAdultContent && item.isAdult) return false
        if (blocked.length) {
            const lower = (item.name ?? '').normalize('NFKC').toLowerCase()  // partial relay data: no name ≠ crash
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

/**
 * Middle card, resolved by priority (first match wins):
 *   released today → just bought → guide for the game you're playing → activity stats
 * Stats is the evergreen floor, so the slot is always filled. All inputs are
 * precomputed on the relay — no round-trips here.
 */
function resolveMiddle(relay: RelayHomeData, session: SessionCard | null, shouldShow: (a: number) => boolean): MiddleCard {
    const { release, justBought, stats } = relay

    if (release && shouldShow(release.appid)) {
        return { kind: 'release', appid: release.appid, name: release.name, header: release.header }
    }

    const bought = pick(justBought.filter(g => shouldShow(g.appid)))
    if (bought) {
        return { kind: 'bought', appid: bought.appid, name: bought.name, header: bought.header, daysAgo: bought.daysAgo }
    }

    if (session?.guide) {
        return { kind: 'guide', appid: session.appid, name: session.name, header: session.header, guide: session.guide }
    }

    return { kind: 'stats', hours: stats.hours, achievements: stats.achievements, ratings: stats.ratings, added: stats.added, wishlisted: stats.wishlisted }
}

export async function load(): Promise<HomeData> {
    // The journal serves its own gaming data at /relay/api/* (fold-in). NOT
    // RELAY_URL — that mail-only shell 404s these now. See journalRelayBase.
    const base = journalRelayBase()

    // The home payload is precomputed + cached, so this is a fast single read;
    // the poster endpoints feed the (12+ tile) mosaics.
    const [homeData, libPosters, wlPosters, discoverData, flags, settings] = await Promise.all([
        fetchJson<RelayHomeData>(`${base}/api/home`),
        fetchJson<HomePoster[]>(`${base}/api/games/posters?source=library&n=50`),
        fetchJson<HomePoster[]>(`${base}/api/games/posters?source=wishlist&n=50`),
        fetchJson<DiscoverSection[]>(`${base}/api/discover/featured`),
        getAllFlags().catch(() => ({} as FlagsStore)),
        getSettings().catch(() => ({ showChildLocked: false, showFiltered: false, showSoftware: false, hideUnavailable: false, titleBlocklist: [], discoverFiltersEnabled: true, hideAdultContent: true, guidePinsCollapsed: false } as Settings)),
    ])

    const shouldShow = makeShouldShow(flags, settings)
    // Field-level defaults, not just null-coalescing: a partial payload from a
    // version-skewed relay ({}) must not crash the load on relay.recentPlayed.find.
    const relay: RelayHomeData = {
        recentPlayed: Array.isArray(homeData?.recentPlayed) ? homeData.recentPlayed : [],
        justBought:   Array.isArray(homeData?.justBought)   ? homeData.justBought   : [],
        stats:        { ...EMPTY_RELAY.stats, ...(homeData?.stats ?? {}) },
        release:      homeData?.release ?? null,
        libPosters:   Array.isArray(homeData?.libPosters)   ? homeData.libPosters   : [],
        wlPosters:    Array.isArray(homeData?.wlPosters)    ? homeData.wlPosters    : [],
    }

    // Session card: the most-recently-played title the filter toggles allow, so a
    // hidden (child-locked / filtered) last game never leaks onto the home page.
    const session = relay.recentPlayed.find(g => shouldShow(g.appid)) ?? null

    return {
        session,
        middle:      resolveMiddle(relay, session, shouldShow),
        libPosters:  (libPosters ?? []).filter(p => shouldShow(p.appid)),
        wlPosters:   (wlPosters  ?? []).filter(p => shouldShow(p.appid)),
        discPosters: sampleDiscover(discoverData ?? [], 50, shouldShow, settings.titleBlocklist ?? [], settings.hideAdultContent),
    }
}
