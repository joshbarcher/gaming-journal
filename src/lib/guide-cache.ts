export interface FtEntry {
    slug:      string
    label:     string
    text:      string
    blockPath?: number[]
}

interface CachedIndex {
    parsedAt: string
    entries:  FtEntry[]
}

const CACHE_PREFIX = 'gft:'

function cacheKey(steamId: string, source: string, guideId: string): string {
    return `${CACHE_PREFIX}${steamId}:${source}:${guideId}`
}

function readCache(key: string, parsedAt: string): FtEntry[] | null {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const cached: CachedIndex = JSON.parse(raw)
        return cached.parsedAt === parsedAt ? cached.entries : null
    } catch {
        return null
    }
}

function writeCache(key: string, parsedAt: string, entries: FtEntry[]): void {
    try {
        const payload: CachedIndex = { parsedAt, entries }
        localStorage.setItem(key, JSON.stringify(payload))
    } catch {
        // QuotaExceededError or localStorage unavailable — evict oldest entry and retry once
        try {
            evictOldest()
            localStorage.setItem(key, JSON.stringify({ parsedAt, entries } satisfies CachedIndex))
        } catch { /* give up */ }
    }
}

function evictOldest(): void {
    let oldestKey: string | null = null
    let oldestAt = ''
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k?.startsWith(CACHE_PREFIX)) continue
        try {
            const v: CachedIndex = JSON.parse(localStorage.getItem(k) ?? '')
            if (!oldestKey || v.parsedAt < oldestAt) { oldestKey = k; oldestAt = v.parsedAt }
        } catch { /* skip corrupt entries */ }
    }
    if (oldestKey) localStorage.removeItem(oldestKey)
}

/**
 * Returns the fulltext index for a guide, using a permanent localStorage cache
 * keyed by parsedAt. The cache is invalidated automatically when the guide is
 * re-parsed (parsedAt changes). Pass null for parsedAt to skip caching.
 */
export async function getCachedFulltext(
    steamId:  string,
    source:   string,
    guideId:  string,
    parsedAt: string | null,
): Promise<FtEntry[]> {
    const key = cacheKey(steamId, source, guideId)

    if (parsedAt) {
        const cached = readCache(key, parsedAt)
        if (cached) return cached
    }

    const entries: FtEntry[] = await fetch(
        `/relay/api/guides/${steamId}/${source}/${encodeURIComponent(guideId)}/fulltext`
    ).then(r => r.ok ? r.json() : [])

    if (parsedAt && entries.length) writeCache(key, parsedAt, entries)

    return entries
}
