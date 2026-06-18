import type { Page, PinState } from './types.js'

interface SidebarCounts {
    library:    number
    wishlist:   number
    favorites:  number
    inProgress: number
    backlog:    number
    dropped:    number
    completed:  number
    franchises: number
}

export interface NowPlayingInfo {
    appid:             number
    name:              string
    elapsed?:          string
    sessionStartedAt?: string | null
}

export interface LastPlayedInfo {
    appid: number
    name:  string
}

class SidebarStore {
    pages        = $state<Page[]>([])
    nowPlaying   = $state<NowPlayingInfo | null>(null)
    lastPlayed   = $state<LastPlayedInfo | null>(null)
    alertsCount  = $state(0)
    historyAppid = $state<number | null>(null)
    counts       = $state<SidebarCounts>({ library: 0, wishlist: 0, favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, franchises: 0 })
    pin          = $state<PinState | null>(null)
}

export const store = new SidebarStore()
