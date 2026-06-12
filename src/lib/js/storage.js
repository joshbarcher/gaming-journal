// Thin localStorage wrapper that adds per-entry TTL support.
// Values are stored as { v: <value>, e: <expiry epoch ms> }.
// Plain (non-TTL) entries written by other code are returned as-is.

const TTL_24H = 24 * 60 * 60 * 1000

export function setWithTTL(key, value, ttlMs = TTL_24H) {
    try {
        localStorage.setItem(key, JSON.stringify({ v: value, e: Date.now() + ttlMs }))
    } catch { /* storage full / private mode */ }
}

export function getWithTTL(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && 'v' in parsed && 'e' in parsed) {
            if (Date.now() > parsed.e) {
                localStorage.removeItem(key)
                return fallback
            }
            return parsed.v
        }
        // Legacy plain value — return as-is (no TTL enforcement)
        return parsed
    } catch {
        return fallback
    }
}
