<script lang="ts">
    import type { AchievementItem, SessionAchievement } from '../../types.js'
    import { cleanAchName } from '../../js/views/journal-render.js'

    interface Props {
        achs:      SessionAchievement[]
        achMap:    Record<string, AchievementItem>
        noDataMsg?: string
    }
    let { achs, achMap, noDataMsg = 'No achievements this session' }: Props = $props()
</script>

{#if !achs.length}
    <p class="gj-no-data">{noDataMsg}</p>
{:else}
    <div class="gj-session-achs">
        {#each achs.slice(0, 8) as a}
            {@const full     = achMap[a.apiname]}
            {@const name     = full?.displayName ?? cleanAchName(a.apiname)}
            {@const src      = full?.localIcon ?? full?.icon ?? null}
            {@const fallback = full?.icon ?? null}
            <div class="gj-session-ach" title={name}>
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
