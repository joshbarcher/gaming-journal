// Ported from InProgress.svelte's progressData() function directly (not just the doc) — exact
// ceiling/fill/label logic, since this is exactly the kind of "verify against the real running app"
// pure logic the project's standing rule calls for.
export type ProgressTick = { pct: number; label: string }
export type ProgressData = { fillPct: number; ticks: ProgressTick[]; label: string }

export function computeHltbProgress(
    playtimeMinutes: number,
    hltb: { gameplayMain?: number | null; gameplayMainExtra?: number | null; gameplayCompletionist?: number | null } | undefined,
): ProgressData | null {
    const playedH = playtimeMinutes / 60
    const main = hltb?.gameplayMain ?? null
    const extra = hltb?.gameplayMainExtra ?? null
    const comp = hltb?.gameplayCompletionist ?? null

    if (!main && !extra && !comp) return null

    const ceiling = (comp ?? extra ?? main)!
    const fillPct = Math.min((playedH / ceiling) * 100, 100)

    const ticks: ProgressTick[] = []
    if (main && main < ceiling) ticks.push({ pct: (main / ceiling) * 100, label: 'Main' })
    if (extra && extra < ceiling) ticks.push({ pct: (extra / ceiling) * 100, label: 'Extras' })

    const pct = (n: number) => Math.round((playedH / n) * 100)
    let label: string
    if (main && playedH < main) label = `${pct(main)}% of Main Story`
    else if (extra && playedH < extra) label = `Main done · ${pct(extra)}% of Main+Extras`
    else if (comp && playedH < comp) label = `Extras done · ${pct(comp)}% completionist`
    else label = 'Past all estimates'

    return { fillPct, ticks, label }
}
