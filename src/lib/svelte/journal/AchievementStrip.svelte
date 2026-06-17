<script lang="ts">
    import type { AchievementItem } from '../../types.js'
    import { onDestroy } from 'svelte'
    import { cleanAchName, fmtDate } from '../../js/views/journal-render.js'

    interface Props { achievements: AchievementItem[] }
    let { achievements }: Props = $props()

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="gj-ach-strip" onmouseover={handleOver} onmouseleave={() => { _lastTip = null; hideTip() }}>
    {#each achievements as a}
        {@const name     = a.displayName ?? cleanAchName(a.apiname)}
        {@const src      = a.localIcon ?? a.icon ?? null}
        {@const fallback = a.icon ?? null}
        {@const date     = fmtDate(new Date((a.unlocktime ?? 0) * 1000))}
        <div class="gj-ach-strip-item"
             data-tip-title={name}
             data-tip-desc={a.description || undefined}>
            {#if src}
                <img
                    class="gj-ach-strip-img"
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
                <div class="gj-ach-strip-fallback">{name[0]?.toUpperCase() ?? '?'}</div>
            {/if}
            <span class="gj-ach-strip-name">{name}</span>
            <span class="gj-ach-strip-date">{date}</span>
        </div>
    {/each}
</div>
