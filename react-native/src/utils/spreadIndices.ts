// Ported verbatim from Franchises.svelte's spreadIndices()/mosaicSlots() — picks evenly-spaced
// indices across an entry list (e.g. a 10-game franchise samples games 0,3,6,9 for its 4-cell
// mosaic, not the first 4), so short and long franchises both get a representative sample.
export function spreadIndices(len: number, n: number): number[] {
    if (len === 0) return []
    if (len <= n) return Array.from({ length: len }, (_, i) => i)
    return Array.from({ length: n }, (_, i) => Math.round((i * (len - 1)) / (n - 1)))
}

// For each of the 4 mosaic slots, returns the primary appid plus a fallback chain (every other
// entry's appid not already used as a primary) — mirrors mosaicCell's progressive <img> fallback,
// adapted for expo-image's onError instead of a Svelte action.
export function mosaicSlots(entries: { appid: number }[], slots = 4): number[][] {
    const spreadIdx = spreadIndices(entries.length, slots)
    const used = new Set(spreadIdx.map(i => entries[i]?.appid).filter((id): id is number => id != null))
    const fallbacks = entries.map(e => e.appid).filter(id => !used.has(id))
    return Array.from({ length: slots }, (_, slot) => {
        const primary = entries[spreadIdx[slot]]?.appid
        return primary != null ? [primary, ...fallbacks] : [...fallbacks]
    })
}
