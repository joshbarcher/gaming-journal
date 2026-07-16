// Shared formatting + image-source helpers for the NexusMods section and pages.

// 494469 → "494K", 24669741 → "24.7M"
// One decimal below 10K / 100M; unit picked AFTER rounding so 999,999 → "1M", never "1000K".
function fmtUnit(value: number, oneDecimalBelow: number): string {
    return value < oneDecimalBelow
        ? value.toFixed(1).replace(/\.0$/, '')
        : String(Math.round(value))
}

export function fmtCompact(n: number | null | undefined): string {
    const v = n ?? 0
    if (!Number.isFinite(v) || v < 1_000) return String(v)
    if (v < 1_000_000) {
        const s = fmtUnit(v / 1_000, 10)
        if (s !== '1000') return s + 'K'   // 999,500+ rounds to 1000K — roll over to M
    }
    return fmtUnit(v / 1_000_000, 100) + 'M'
}

// Nexus fileSize is in KB. 164895 → "161 MB", 2048 → "2 MB", 512 → "512 KB"
export function fmtSize(kb: number | null | undefined): string {
    if (!kb || kb <= 0) return ''
    if (kb < 1_024) return Math.round(kb) + ' KB'
    if (kb < 1_048_576) {
        const mb = Math.round(kb / 1_024)
        if (mb < 1_024) return mb + ' MB'  // 1,048,064+ KB rounds to 1024 MB — roll over to GB
    }
    return (kb / 1_048_576).toFixed(1).replace(/\.0$/, '') + ' GB'
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
