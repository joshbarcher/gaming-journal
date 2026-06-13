<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { AchievementItem } from '../../types.js'
    import { mergeSessionAchievements, renderAchItem } from '../../js/views/journal-render.js'

    let { appid } = $props()

    let achList    = $state<AchievementItem[]>([])
    let loading    = $state(true)
    let showHidden = $state(false)

    let unlocked     = $derived([...achList].filter(a => a.achieved).sort((a, b) => (b.unlocktime ?? 0) - (a.unlocktime ?? 0)))
    let lockedVis    = $derived(achList.filter(a => !a.achieved && !a.hidden))
    let lockedHidden = $derived(achList.filter(a => !a.achieved && a.hidden))

    // Tooltip
    let tooltipEl: HTMLElement | null = null
    let _lastTip: Element | null      = null

    function showTip(text: string, rect: DOMRect) {
        if (!tooltipEl) {
            tooltipEl = document.createElement('div')
            tooltipEl.className = 'gj-tooltip'
            document.body.appendChild(tooltipEl)
        }
        tooltipEl.textContent = text
        tooltipEl.style.display = 'block'
        requestAnimationFrame(() => {
            if (!tooltipEl) return
            const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight, gap = 8
            let x = rect.left + rect.width / 2 - tw / 2
            let y = rect.top - th - gap
            if (y < gap) y = rect.bottom + gap
            tooltipEl.style.left = Math.max(gap, Math.min(x, window.innerWidth  - tw - gap)) + 'px'
            tooltipEl.style.top  = Math.max(gap, Math.min(y, window.innerHeight - th - gap)) + 'px'
        })
    }

    function hideTip() { if (tooltipEl) tooltipEl.style.display = 'none' }

    function handleOver(e: MouseEvent) {
        const el = (e.target as Element)?.closest('[data-tooltip]')
        if (el === _lastTip) return
        _lastTip = el
        if (el) showTip((el as HTMLElement).dataset.tooltip ?? '', el.getBoundingClientRect())
        else hideTip()
    }

    onMount(async () => {
        const [achRes, npRes] = await Promise.allSettled([
            fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null).catch(() => null),
        ])
        const raw: AchievementItem[] = (achRes as PromiseFulfilledResult<any>).value?.achievements ?? []
        const np     = (npRes as PromiseFulfilledResult<any>).value ?? null
        const sess   = np?.playing?.appid === Number(appid) ? np.playing : null
        achList = mergeSessionAchievements(raw, sess?.achievementsDuring)
        loading = false
    })

    onDestroy(() => {
        if (tooltipEl) { tooltipEl.remove(); tooltipEl = null }
    })
</script>

{#if loading}
    <p class="page-loading">Loading…</p>
{:else}
<div class="gj-sub-header" onmouseover={handleOver} onmouseleave={() => { _lastTip = null; hideTip() }}>
    <a href="/journal/{appid}" class="gj-sub-back">&#8592; Journal</a>
    <span class="gj-sub-title">Achievements</span>
    {#if lockedHidden.length > 0}
        <div class="gj-sub-actions">
            <label class="gj-ach-toggle">
                <input type="checkbox" bind:checked={showHidden}>
                Show hidden ({lockedHidden.length})
            </label>
        </div>
    {/if}
</div>

<div onmouseover={handleOver} onmouseleave={() => { _lastTip = null; hideTip() }}>
    {#if achList.length === 0}
        <p class="gj-no-data">No achievement data available.</p>
    {/if}

    {#if unlocked.length > 0}
        <p class="gj-ach-section-label">Unlocked ({unlocked.length})</p>
        <div class="gj-ach-grid">
            {#each unlocked as a (a.apiname)}
                {@html renderAchItem(a, true, false)}
            {/each}
        </div>
    {/if}

    {#if lockedVis.length > 0}
        <p class="gj-ach-section-label">Locked ({lockedVis.length})</p>
        <div class="gj-ach-grid">
            {#each lockedVis as a (a.apiname)}
                {@html renderAchItem(a, false, false)}
            {/each}
        </div>
    {/if}

    {#if showHidden && lockedHidden.length > 0}
        <p class="gj-ach-section-label">Hidden ({lockedHidden.length})</p>
        <div class="gj-ach-grid">
            {#each lockedHidden as a (a.apiname)}
                {@html renderAchItem(a, false, true)}
            {/each}
        </div>
    {/if}
</div>
{/if}
