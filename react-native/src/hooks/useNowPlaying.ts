import { useQuery } from '@tanstack/react-query'

import { getNowPlaying } from '@/api/sidebar'

// Matches the web app's 60s poll (global/sidebar.md: fetchNowPlaying()).
export function useNowPlaying() {
    return useQuery({
        queryKey:        ['nowPlaying'],
        queryFn:         getNowPlaying,
        refetchInterval: 60_000,
    })
}
