// Fetches global settings + all game flags, returns a shouldShow(appid) predicate.
// Call once per page load; the returned function is synchronous and fast.
export async function loadGameFilter() {
    try {
        const [settingsRes, flagsRes] = await Promise.all([
            fetch('/api/settings'),
            fetch('/api/flags'),
        ])
        const settings = settingsRes.ok ? await settingsRes.json() : {}
        const allFlags = flagsRes.ok    ? await flagsRes.json()    : {}

        return function shouldShow(appid) {
            const f = allFlags[String(appid)] ?? {}
            if (f.childLock && !settings.showChildLocked) return false
            if (f.filtered  && !settings.showFiltered)   return false
            return true
        }
    } catch {
        return () => true  // fail open
    }
}
