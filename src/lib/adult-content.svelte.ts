// Client-side mirror of the single "Hide Adult-Only Content" setting (settingsService
// `hideAdultContent`, default true). Mod thumbnails/hero images blur according to THIS
// toggle rather than a separate control — when it's off, 18+ mods show unblurred.
class AdultContentStore {
    hide = $state(true)   // default matches the server default (hide until we know otherwise)

    #loadSeq = 0          // last-call-wins: a slow stale response must not clobber a newer load()

    // Refresh from the settings endpoint. Cheap (local file read); called on mount so the
    // value is current when a page lands. Safe default direction: starts blurred, only
    // ever unblurs once we confirm the toggle is off.
    async load() {
        const seq = ++this.#loadSeq
        try {
            const r = await fetch('/api/settings')
            if (!r.ok) return
            const hide = (await r.json()).hideAdultContent ?? true
            if (seq === this.#loadSeq) this.hide = hide
        } catch { /* keep last/default */ }
    }
}

export const adultContent = new AdultContentStore()
