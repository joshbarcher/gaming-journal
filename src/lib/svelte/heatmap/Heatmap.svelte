<script lang="ts">
    import type { Page } from '$lib/types.js'
    import { progressPercent, isSuperComplete } from '../../js/utils.js'
    import { heatmapRows } from '../../js/views/progress-helpers.js'
    import Icon from '../Icon.svelte'

    const BADGE_THEMES = ['badge--teal', 'badge--purple', 'badge--blue', 'badge--rose', 'badge--amber']
    // Ranked milestone ramp: bronze → silver → gold → premium (replaces the old ✦◈✸⬡◆✤ glyphs)
    const BADGE_ICONS = [
        { name: 'award',    tone: 'bronze' },
        { name: 'medal',    tone: 'silver' },
        { name: 'trophy',   tone: 'gold'   },
        { name: 'crown',    tone: 'gold'   },
        { name: 'gem',      tone: 'sky'    },
        { name: 'sparkles', tone: 'lilac'  },
    ] as const

    let { pages }: { pages: Page[] } = $props()

    let rows      = $derived(heatmapRows(pages))
    let eligible  = $derived(pages.filter((p: Page) => p.type === 'progress' || p.type === 'progress-bars' || p.type === 'list'))
    let completed = $derived(eligible.filter((p: Page) => progressPercent(p) === 100))
    let allDone   = $derived(completed.length === eligible.length && eligible.length > 0)
</script>

<div class="page-header">
    <h1 class="page-title">Progress</h1>
    <p class="page-subtitle">(Heatmap)</p>
</div>

{#if rows.length === 0}
    <p class="page-subtitle">No progress pages yet. Create a Progress or Multi-Bar page to see data here.</p>
{:else}
    <div class="heatmap-grid">
        {#each rows as row (row.id)}
            <div class="heatmap-row">
                <a class="heatmap-label" href="#{row.id}" title={row.title}>{row.title}</a>
                <div class="heatmap-cells">
                    {#if row.cells.length === 0}
                        <div class="heatmap-cell heatmap-cell--dim" title="{row.title} · no tasks"></div>
                    {:else}
                        {#each row.cells as cell}
                            <a class="heatmap-cell"
                               class:heatmap-cell--optional-done={cell.optional && cell.done}
                               class:heatmap-cell--optional={cell.optional && !cell.done}
                               href="#{row.id}"
                               style="background:{cell.color}"
                               title={[row.title, cell.label || `#${cell.num}`, cell.stateLabel, cell.optional ? '(optional)' : null].filter(Boolean).join(' · ')}></a>
                        {/each}
                    {/if}
                </div>
            </div>
        {/each}
    </div>
{/if}

{#if completed.length > 0}
    <div class="badges-section">
        <div class="badges-heading">Achievements</div>
        <div class="badges-row">
            {#if allDone}
                <div class="badge-wrap" style="animation-delay:{Math.random() * 0.15}s">
                    <div class="badge badge--gold badge--star badge--large">
                        <div class="badge-icon">★</div>
                    </div>
                    <div class="badge-label">Journal{'\n'}Complete</div>
                </div>
            {/if}
            {#each completed as page, i}
                {@const theme   = BADGE_THEMES[i % BADGE_THEMES.length]}
                {@const icon    = BADGE_ICONS[(i + 2) % BADGE_ICONS.length]}
                {@const isSuper = isSuperComplete(page)}
                <div class="badge-wrap" style="animation-delay:{Math.random() * 0.15}s">
                    <div class="badge {theme}{isSuper ? ' badge--super' : ''}">
                        <div class="badge-icon">
                            {#if isSuper}
                                <span><Icon name={icon.name} tone={icon.tone} size={24} /></span><span><Icon name={icon.name} tone={icon.tone} size={24} /></span>
                            {:else}
                                <Icon name={icon.name} tone={icon.tone} size={24} />
                            {/if}
                        </div>
                    </div>
                    <div class="badge-label">{page.title}</div>
                </div>
            {/each}
        </div>
    </div>
{/if}
