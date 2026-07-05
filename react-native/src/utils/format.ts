// Extracted once Backlog needed the same playtime formatting Library already had — second real
// call site, not a premature abstraction.
export function formatPlaytime(minutes: number): string {
    if (minutes <= 0) return 'Not played'
    if (minutes < 60) return `${minutes}m`
    return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h`
}
