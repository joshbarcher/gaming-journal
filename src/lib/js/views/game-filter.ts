export async function loadGameFilter(): Promise<(appid: string | number) => boolean> {
    try {
        const [settingsRes, flagsRes] = await Promise.all([
            fetch('/api/settings'),
            fetch('/api/flags'),
        ])
        const settings = settingsRes.ok ? await settingsRes.json() : {}
        const allFlags = flagsRes.ok    ? await flagsRes.json()    : {}

        return function shouldShow(appid: string | number): boolean {
            const f = allFlags[String(appid)] ?? {}
            if (f.childLock && !settings.showChildLocked) return false
            if (f.filtered  && !settings.showFiltered)   return false
            if (f.software)                               return false
            return true
        }
    } catch {
        return () => true
    }
}
