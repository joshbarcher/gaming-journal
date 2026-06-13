<script lang="ts">
    import type { AchievementItem } from '../../types.js'
    import { cleanAchName, fmtDate } from '../../js/views/journal-render.js'

    interface Props {
        achievement: AchievementItem
        isUnlocked:  boolean
        isHidden:    boolean
    }

    let { achievement: a, isUnlocked, isHidden }: Props = $props()

    let name        = $derived(a.displayName ?? cleanAchName(a.apiname))
    let localSrc    = $derived(isUnlocked ? (a.localIcon ?? null) : (a.localIconGray ?? null))
    let cdnFallback = $derived(isUnlocked ? (a.icon ?? null) : (a.icongray ?? a.icon ?? null))
    let imgSrc      = $derived(localSrc ?? cdnFallback)
    let date        = $derived(isUnlocked && a.unlocktime ? fmtDate(new Date(a.unlocktime * 1000)) : '')
    let desc        = $derived(!isHidden ? (a.description ?? '') : '')
    let badgeCls    = $derived(isUnlocked ? 'gj-ach-badge--unlocked' : 'gj-ach-badge--locked')
    let letter      = $derived(name[0]?.toUpperCase() ?? '?')
</script>

<div class="gj-ach-full-item" class:gj-ach-full-item--unlocked={isUnlocked}>
    {#if imgSrc}
        <img
            class="gj-ach-badge"
            src={imgSrc}
            alt=""
            onerror={(ev) => {
                const img = ev.currentTarget as HTMLImageElement
                if (localSrc && cdnFallback) {
                    img.onerror = null
                    img.src = cdnFallback
                } else {
                    img.outerHTML = `<div class="gj-ach-badge ${badgeCls}">${letter}</div>`
                }
            }}
        />
    {:else}
        <div class="gj-ach-badge {badgeCls}">{letter}</div>
    {/if}
    <div class="gj-ach-info">
        <div class="gj-ach-full-name" data-tooltip={name}>{name}</div>
        {#if desc}<div class="gj-ach-full-desc" data-tooltip={desc}>{desc}</div>{/if}
        {#if date}<div class="gj-ach-full-date">{date}</div>{/if}
    </div>
</div>
