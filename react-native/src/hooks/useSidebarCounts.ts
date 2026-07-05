import { useQuery } from '@tanstack/react-query'

import { getAlerts } from '@/api/alerts'
import { getFlags } from '@/api/flags'
import { getFranchises } from '@/api/franchises'
import { getSteamGamesList } from '@/api/games'
import { getWishlist } from '@/api/wishlist'

// Matches global/sidebar.md's SidebarCounts, computed client-side from flags + the games list
// (the web version does this once on mount via +layout.svelte; same "fetch once" semantics here —
// no refetchInterval, TanStack's default staleTime covers "won't update mid-session" parity).
// Wishlist/franchises/alerts all reuse the exact same queryKeys their own screens use (['wishlist'],
// ['franchises'], ['alerts']), so mounting the sidebar alongside those screens doesn't double-fetch.
export type SidebarCounts = {
    library:     number
    favorites:   number
    inProgress:  number
    backlog:     number
    dropped:     number
    completed:   number
    wishlist:    number
    franchises:  number
    onSale:      number
}

export function useSidebarCounts() {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const wishlistQuery = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist })
    const franchisesQuery = useQuery({ queryKey: ['franchises'], queryFn: getFranchises })
    const alertsQuery = useQuery({ queryKey: ['alerts'], queryFn: getAlerts })

    const counts: SidebarCounts | undefined = flagsQuery.data && gamesQuery.data ? {
        library:    gamesQuery.data.length,
        favorites:  countFlag(flagsQuery.data, 'favorite'),
        inProgress: countFlag(flagsQuery.data, 'inProgress'),
        backlog:    countFlag(flagsQuery.data, 'backlog'),
        dropped:    countFlag(flagsQuery.data, 'dropped'),
        completed:  countFlag(flagsQuery.data, 'completed'),
        wishlist:   wishlistQuery.data?.length ?? 0,
        franchises: franchisesQuery.data?.length ?? 0,
        onSale:     alertsQuery.data?.onSale.length ?? 0,
    } : undefined

    return {
        counts,
        isLoading: flagsQuery.isLoading || gamesQuery.isLoading,
        isError:   flagsQuery.isError || gamesQuery.isError,
    }
}

function countFlag(flags: Record<string, Record<string, boolean | undefined>>, key: string): number {
    return Object.values(flags).filter(f => f[key]).length
}
