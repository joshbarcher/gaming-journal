// Extracted once Backlog needed the same playtime formatting Library already had — second real
// call site, not a premature abstraction.
export function formatPlaytime(minutes: number): string {
    if (minutes <= 0) return 'Not played'
    if (minutes < 60) return `${minutes}m`
    // Round hours the way the web's fmtHours does so totals/badges read identically
    // (≥100 → whole, ≥10 → nearest 0.5, else nearest 0.1) — was `.toFixed(1)`, which printed
    // "1036.0h" where the web shows "1036h".
    const h = minutes / 60
    const rounded = h >= 100 ? Math.round(h) : h >= 10 ? Math.round(h * 2) / 2 : Math.round(h * 10) / 10
    return `${rounded}h`
}
