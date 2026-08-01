// Bridges guide content to the Tributary embed player — "Mode A: the loader" from
// C:\dev\tributary\docs\general\embedding.md, the same integration the communities app
// uses (src/lib/client/tributary.ts there).
//
// Guides store the canonical YouTube URL on disk (that's the archival record; see
// docs/features/guides/videos.md). Everything the reader touches is Tributary: the href
// they hover, the page a middle-click opens, and the modal a plain click opens. The
// loader is fetched lazily rather than via `data-auto` in app.html, because guide
// content renders client-side after a section fetch — there is nothing for a load-time
// pass to wrap, and most pages have no video at all.

import { browser } from '$app/environment'

/** Tributary on the LAN / Tailscale. The loader self-detects this from its own <script src>. */
const LOADER_SRC = 'https://tributary.home/embed.js'

/** Origin the loader and player live at — derived from LOADER_SRC so there's one source of truth. */
export const TRIBUTARY_ORIGIN = new URL(LOADER_SRC).origin

/**
 * The Tributary player URL for a video id, used as the href of every video link and
 * card. The loader recognises its own /embed/<id> links, so a plain click still opens
 * the modal; a modified click (or an unreachable loader) lands on the full player page.
 */
export function tributaryEmbedUrl(id: string, startAt?: number): string {
    const t = startAt && startAt > 0 ? `?t=${Math.floor(startAt)}` : ''
    return `${TRIBUTARY_ORIGIN}/embed/${encodeURIComponent(id)}${t}`
}

// Per-id title cache (stores the in-flight/resolved promise) so the same video linked
// twice — or a re-render — never refetches.
const titleCache = new Map<string, Promise<string | null>>()

/**
 * A video's title from Tributary's /api/video/[id], for labelling a card. Resolves null
 * when Tributary is unreachable or the video is unknown; callers fall back to their own
 * placeholder rather than showing a bare id.
 */
export function fetchTributaryTitle(id: string): Promise<string | null> {
    if (!browser) return Promise.resolve(null)
    let pending = titleCache.get(id)
    if (!pending) {
        pending = fetch(`${TRIBUTARY_ORIGIN}/api/video/${encodeURIComponent(id)}`)
            .then(r => (r.ok ? r.json() : null))
            .then((d: { title?: unknown } | null) => (d && typeof d.title === 'string' ? d.title : null))
            .catch(() => null)
        titleCache.set(id, pending)
    }
    return pending
}

interface TributaryGlobal {
    open(idOrUrl: string, opts?: { autoplay?: boolean; startAt?: number; muted?: boolean }): unknown
    wrapLinks(root?: Element | Document): number
}

function getGlobal(): TributaryGlobal | undefined {
    return (window as unknown as { Tributary?: TributaryGlobal }).Tributary
}

// In-flight / successful load, shared by every caller. A *failed* load is deliberately
// not cached, so a guide left open picks Tributary up on the next click once it's back.
let loader: Promise<TributaryGlobal | null> | null = null

function ensureLoader(): Promise<TributaryGlobal | null> {
    if (!browser) return Promise.resolve(null)
    const existing = getGlobal()
    if (existing) return Promise.resolve(existing)
    loader ??= new Promise(resolve => {
        const script = document.createElement('script')
        script.src = LOADER_SRC
        script.async = true
        // Resolve null rather than reject when Tributary is unreachable, so a click
        // degrades to following the link instead of throwing. Drop the cached promise
        // and the dead <script> so the next attempt starts fresh.
        const fail = () => {
            loader = null
            script.remove()
            resolve(null)
        }
        script.onload = () => {
            const t = getGlobal()
            if (t) resolve(t)
            else fail()
        }
        script.onerror = fail
        document.head.appendChild(script)
    })
    return loader
}

/**
 * Start fetching the loader, so a later click can decide synchronously whether the modal
 * is available. Call it when a page turns out to have video on it — fire and forget.
 */
export function preloadTributary(): void {
    void ensureLoader()
}

/**
 * Open a video in Tributary's modal player, if the loader is already in hand.
 *
 * Synchronous by design: a click handler has to choose between the modal and the link
 * before it returns. Awaiting the loader would mean either preventing default on a click
 * that then fails to open anything, or calling window.open() outside the user gesture and
 * getting popup-blocked. So preload first (above) and treat "not loaded yet" like "not
 * available": the browser follows the href to Tributary's own player page.
 *
 * @returns true if the modal opened, i.e. the caller should preventDefault.
 */
export function openTributarySync(id: string, startAt?: number): boolean {
    if (!browser) return false
    const tributary = getGlobal()
    if (!tributary) {
        void ensureLoader()   // not ready this time; be ready for the next click
        return false
    }
    tributary.open(id, startAt ? { startAt } : undefined)
    return true
}

/** Start time in seconds from a YouTube URL's `t` / `start` parameter (1h2m3s, 90s or 90). */
export function startSeconds(url: string): number | undefined {
    let raw: string | null = null
    try {
        const u = new URL(url, TRIBUTARY_ORIGIN)
        raw = u.searchParams.get('t') ?? u.searchParams.get('start')
    } catch { return undefined }
    if (!raw) return undefined
    if (/^\d+$/.test(raw)) return Number(raw)
    const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i)
    if (!m || !m[0]) return undefined
    const secs = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    return secs > 0 ? secs : undefined
}
