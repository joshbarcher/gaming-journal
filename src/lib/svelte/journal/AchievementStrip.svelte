<script lang="ts">
    import type { AchievementItem } from '../../types.js'
    import { cleanAchName, fmtDate } from '../../js/views/journal-render.js'

    interface Props { achievements: AchievementItem[] }
    let { achievements }: Props = $props()
</script>

{#each achievements as a}
    {@const name     = a.displayName ?? cleanAchName(a.apiname)}
    {@const src      = a.localIcon ?? a.icon ?? null}
    {@const fallback = a.icon ?? null}
    {@const date     = fmtDate(new Date((a.unlocktime ?? 0) * 1000))}
    <div class="gj-ach-strip-item" title={name}>
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
