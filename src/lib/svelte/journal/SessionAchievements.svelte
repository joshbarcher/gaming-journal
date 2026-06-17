<script lang="ts">
    import type { AchievementItem, SessionAchievement } from '../../types.js'
    import { onDestroy } from 'svelte'
    import { cleanAchName } from '../../js/views/journal-render.js'

    interface Props {
        achs:      SessionAchievement[]
        achMap:    Record<string, AchievementItem>
        noDataMsg?: string
    }
    let { achs, achMap, noDataMsg = 'No achievements this session' }: Props = $props()

    let tipEl: HTMLElement | null = null
    let _lastTip: HTMLElement | null = null

    function showTip(title: string, desc: string | undefined, rect: DOMRect) {
        if (!tipEl) {
            tipEl = document.createElement('div')
            tipEl.className = 'gj-tooltip'
            document.body.appendChild(tipEl)
        }
        tipEl.innerHTML = ''
        const titleEl = document.createElement('strong')
        titleEl.textContent = title
        tipEl.appendChild(titleEl)
        if (desc) {
            const descEl = document.createElement('span')
            descEl.style.cssText = 'display:block;margin-top:4px;opacity:0.72;font-size:11px;font-weight:400'
            descEl.textContent = desc
            tipEl.appendChild(descEl)
        }
        tipEl.style.display = 'block'
        requestAnimationFrame(() => {
            if (!tipEl) return
            const tw = tipEl.offsetWidth, th = tipEl.offsetHeight, gap = 8
            let x = rect.left + rect.width / 2 - tw / 2
            let y = rect.top - th - gap
            if (y < gap) y = rect.bottom + gap
            tipEl.style.left = Math.max(gap, Math.min(x, window.innerWidth  - tw - gap)) + 'px'
            tipEl.style.top  = Math.max(gap, Math.min(y, window.innerHeight - th - gap)) + 'px'
        })
    }

    function hideTip() { if (tipEl) tipEl.style.display = 'none' }

    function handleOver(e: MouseEvent) {
        const el = (e.target as Element)?.closest<HTMLElement>('[data-tip-title]') ?? null
        if (el === _lastTip) return
        _lastTip = el
        if (el) showTip(el.dataset.tipTitle!, el.dataset.tipDesc, el.getBoundingClientRect())
        else hideTip()
    }

    onDestroy(() => {
        if (tipEl) { tipEl.remove(); tipEl = null }
    })
</script>

{#if !achs.length}
    <p class="gj-no-data">{noDataMsg}</p>
{:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="gj-session-achs" onmouseover={handleOver} onmouseleave={() => { _lastTip = null; hideTip() }}>
        {#each achs.slice(0, 8) as a}
            {@const full     = achMap[a.apiname]}
            {@const name     = full?.displayName ?? cleanAchName(a.apiname)}
            {@const src      = full?.localIcon ?? full?.icon ?? null}
            {@const fallback = full?.icon ?? null}
            <div class="gj-session-ach"
                 data-tip-title={name}
                 data-tip-desc={full?.description || undefined}>
                {#if src}
                    <img
                        class="gj-session-ach-img"
                        {src}
                        alt=""
                        onerror={(ev) => {
                            const img = ev.currentTarget as HTMLImageElement
                            if (src && fallback && src !== fallback) {
                                img.onerror = null
                                img.src = fallback
                            } else {
                                img.style.visibility = 'hidden'
                            }
                        }}
                    />
                {:else}
                    <div class="gj-session-ach-img gj-session-ach-img--fallback">
                        {name[0]?.toUpperCase() ?? '?'}
                    </div>
                {/if}
            </div>
        {/each}
        {#if achs.length > 8}
            <span class="gj-session-ach-more">+{achs.length - 8} more</span>
        {/if}
    </div>
{/if}
