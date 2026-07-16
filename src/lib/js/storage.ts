const TTL_24H = 24 * 60 * 60 * 1000

export function setWithTTL(key: string, value: unknown, ttlMs = TTL_24H): void {
    try {
        localStorage.setItem(key, JSON.stringify({ v: value, e: Date.now() + ttlMs }))
    } catch { /* storage full / private mode */ }
}

export function getWithTTL<T = unknown>(key: string, fallback: T | null = null): T | null {
    try {
        const raw = localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && 'e' in parsed && ('v' in parsed || Object.keys(parsed).length === 1)) {
            if (Date.now() > parsed.e) {
                localStorage.removeItem(key)
                return fallback
            }
            // An envelope missing "v" means setWithTTL was given undefined
            // (JSON.stringify drops the key) — that's an absent value, not data.
            return ('v' in parsed ? parsed.v : fallback) as T
        }
        return parsed as T
    } catch {
        return fallback
    }
}
