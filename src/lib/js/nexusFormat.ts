// Shared formatting + image-source helpers for the NexusMods section and pages.

// 494469 → "494K", 24669741 → "24.7M"
export function fmtCompact(n: number | null | undefined): string {
    const v = n ?? 0
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M'
    if (v >= 1_000)     return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K'
    return String(v)
}

// Nexus fileSize is in KB. 164895 → "161 MB", 2048 → "2 MB", 512 → "512 KB"
export function fmtSize(kb: number | null | undefined): string {
    if (!kb || kb <= 0) return ''
    if (kb >= 1_048_576) return (kb / 1_048_576).toFixed(1).replace(/\.0$/, '') + ' GB'
    if (kb >= 1_024)     return Math.round(kb / 1_024) + ' MB'
    return Math.round(kb) + ' KB'
}

interface ThumbLike { localThumb?: string | null; thumbUrl?: string | null; imageUrl?: string | null }
interface ImageLike { localImage?: string | null; imageLargeUrl?: string | null; imageUrl?: string | null; thumbUrl?: string | null }

// Prefer the relay-mirrored (WebP) copy; fall back to the Nexus CDN.
export function nexusThumb(mod: ThumbLike): string {
    if (mod.localThumb) return `/relay${mod.localThumb}`
    return mod.thumbUrl ?? mod.imageUrl ?? ''
}
export function nexusImage(mod: ImageLike): string {
    if (mod.localImage) return `/relay${mod.localImage}`
    return mod.imageLargeUrl ?? mod.imageUrl ?? mod.thumbUrl ?? ''
}

// onerror handler: fall back to the CDN once, then hide the broken image.
export function nexusImgError(e: Event, cdn: string | null | undefined) {
    const img = e.currentTarget as HTMLImageElement
    if (cdn && !img.dataset.fellBack) { img.dataset.fellBack = '1'; img.src = cdn; return }
    img.style.visibility = 'hidden'
}
