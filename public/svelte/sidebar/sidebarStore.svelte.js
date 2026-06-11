class SidebarStore {
    pages        = $state([])
    activeId     = $state(null)
    nowPlaying   = $state(null)
    alertsCount  = $state(0)
    historyAppid = $state(null)
    counts       = $state({ library: 0, wishlist: 0, favorites: 0, inProgress: 0, backlog: 0, dropped: 0, completed: 0, franchises: 0 })
    navigate     = null  // plain function ref, set by sidebar.js on init
}

export const store = new SidebarStore()
