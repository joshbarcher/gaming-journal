import { useQuery } from '@tanstack/react-query'

import { getApiHost } from '@/api/config'

// Relay/gateway image paths (e.g. resume.header = "/relay/images/steam/games/2161700/header.jpg")
// come back as host-relative strings — unlike a browser same-origin <img>, RN's Image component
// has no implicit "page origin" to resolve them against, so every image URL needs this prepended.
// Caught by the screenshot-first workflow: the Home screen's resume image rendered blank until
// this was wired in (see react-native/TODO.md "0.5 Responsive infrastructure").
//
// **`staleTime: Infinity` was a real bug, found on the first real device install**: every other
// `apiGet`/`apiPost`/etc. call reads `getApiHost()` fresh every time (cheap — AsyncStorage read +
// a module-level memo), so it always reflects the CURRENT default host baked into whatever build
// is running. This hook's own value, though, got cached into the PERSISTED TanStack Query storage
// (queryClient.ts's AsyncStorage persister) the first time it ever resolved — and with
// `Infinity`, it would never be considered stale again, EVEN ACROSS APP UPDATES, since a normal
// `adb install -r` / Play Store update does not wipe app-private storage. Confirmed live: after
// changing `DEFAULT_HOST` and reinstalling, `logcat` showed every JSON fetch correctly hitting the
// new LAN host while every image fetch (Glide/ExpoImage, reading `apiHostQuery.data`) kept trying
// the stale `localhost:8061` from the very first install — this hook's cached value never
// refreshed. Removed the custom staleTime — this now uses the same 60s default every other query
// in this app already gets from `queryClient.ts`, so a stale persisted value (from this device's
// history, or the next time the default host changes) self-heals within a minute of app start
// instead of never.
export function useApiHost() {
    return useQuery({ queryKey: ['apiHost'], queryFn: getApiHost })
}
