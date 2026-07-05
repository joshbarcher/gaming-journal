// Server-state layer — replaces the web app's ad hoc setWithTTL/getWithTTL (src/lib/js/storage.ts)
// uniformly: every query result is cached to AsyncStorage and rehydrated on app start, with the
// same "eventually-consistent read cache, explicit refetch on demand" model the relay itself uses.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60_000, // most relay GETs are backed by a cache anyway; avoid refetch storms
            retry:     1,
        },
    },
})

const asyncStoragePersister = createAsyncStoragePersister({
    storage: AsyncStorage,
    key:     'gj:query-cache',
})

export const persistOptions: PersistQueryClientOptions = {
    queryClient,
    persister:  asyncStoragePersister,
    maxAge:     24 * 60 * 60 * 1000, // 24h — matches the web app's TTL_24H convention in storage.ts
}
