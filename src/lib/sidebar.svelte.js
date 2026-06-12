class SidebarStore {
    pages        = $state([])
    nowPlaying   = $state(null)
    alertsCount  = $state(0)
    historyAppid = $state(null)
    counts       = $state({ library: 0, wishlist: 0, favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, franchises: 0 })
}

export const store = new SidebarStore()
