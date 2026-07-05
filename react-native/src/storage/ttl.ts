// Port of the web app's src/lib/js/storage.ts setWithTTL/getWithTTL — same {v, e} envelope and
// expiry semantics, but async (AsyncStorage has no synchronous API, unlike localStorage). This is
// only for the handful of things TanStack Query doesn't already cover: plain client-only prefs
// like sort/dir/last-scroll-position, not server data (that's queryClient.ts's job).
import AsyncStorage from '@react-native-async-storage/async-storage'

const TTL_24H = 24 * 60 * 60 * 1000

type Envelope<T> = { v: T; e: number }

export async function setWithTTL(key: string, value: unknown, ttlMs = TTL_24H): Promise<void> {
    try {
        const envelope: Envelope<unknown> = { v: value, e: Date.now() + ttlMs }
        await AsyncStorage.setItem(key, JSON.stringify(envelope))
    } catch {
        // storage full / unavailable — same silent-fail behavior as the web version
    }
}

export async function getWithTTL<T = unknown>(key: string, fallback: T | null = null): Promise<T | null> {
    try {
        const raw = await AsyncStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && 'v' in parsed && 'e' in parsed) {
            if (Date.now() > parsed.e) {
                await AsyncStorage.removeItem(key)
                return fallback
            }
            return parsed.v as T
        }
        return parsed as T
    } catch {
        return fallback
    }
}
