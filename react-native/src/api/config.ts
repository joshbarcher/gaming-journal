// Configurable API host — the RN app talks to exactly one gateway (the existing SvelteKit
// server, which already proxies relay-server + SSE), reached over Tailscale when off the home
// LAN. See PLAN.md "Single gateway, no relay changes."
import AsyncStorage from '@react-native-async-storage/async-storage'

const HOST_KEY = 'gj:api-host'

// localhost:8061 only ever worked for the web target (this machine's own browser, Phase 0-6 dev
// work) — on a real device "localhost" is the device's own loopback, not the dev machine's, so
// every request 404s/times out with no server there at all (confirmed live: the first real device
// install showed "No data" everywhere, exactly this). Switched to the real LAN address of the
// gaming-journal gateway (confirmed reachable directly, not guessed) now that real device testing
// has actually started — relay-server co-locates on the same host at :8050, but the app must talk
// to the SvelteKit gateway specifically (PLAN.md's "single gateway" decision — flags/settings/
// pages/local-reviews/etc. are gaming-journal's own routes, not proxied by relay at all).
// Overridable anytime via setApiHost() (see the Settings screen) — this is just the default.
const DEFAULT_HOST = 'http://192.168.86.65:8061'
// For local-only testing (emulator + relay/gateway both on this dev machine, in isolation from the
// flaky remote box): override via the Settings screen to 'http://10.0.2.2:8061' — the Android
// emulator's special alias for the HOST machine's own localhost. Plain 'localhost' from inside the
// emulator means the emulator's own loopback, not this machine's.

let cachedHost: string | null = null

export async function getApiHost(): Promise<string> {
    if (cachedHost) return cachedHost
    const stored = await AsyncStorage.getItem(HOST_KEY)
    cachedHost = stored ?? DEFAULT_HOST
    return cachedHost
}

export async function setApiHost(host: string): Promise<void> {
    const normalized = host.replace(/\/$/, '')
    cachedHost = normalized
    await AsyncStorage.setItem(HOST_KEY, normalized)
}
