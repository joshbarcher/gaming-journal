// Mirrors the web's `localStorage` key `disc-title-blocklist` — Discover reads this for an
// instant initial paint before its own `/api/settings` fetch resolves, then re-mirrors whatever
// the authoritative fetch returns. Plain AsyncStorage get/set, no TTL envelope (unlike
// storage/ttl.ts) since localStorage itself never expires either — this is a straight mirror, not
// a cache with a freshness window.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'disc-title-blocklist'

export async function getCachedBlocklist(): Promise<string[]> {
    try {
        const raw = await AsyncStorage.getItem(KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

export async function setCachedBlocklist(list: string[]): Promise<void> {
    try {
        await AsyncStorage.setItem(KEY, JSON.stringify(list))
    } catch {
        // storage full/unavailable — same silent-fail behavior as the web's try/catch around
        // localStorage.setItem
    }
}
