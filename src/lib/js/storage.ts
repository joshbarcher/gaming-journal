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
        if (parsed && typeof parsed === 'object' && 'v' in parsed && 'e' in parsed) {
            if (Date.now() > parsed.e) {
                localStorage.removeItem(key)
                return fallback
            }
            return parsed.v as T
        }
        return parsed as T
    } catch {
        return fallback
    }
}
