<script lang="ts">
    import { onMount } from 'svelte'
    import type { Page } from '../../types.js'
    import { api } from '../../js/api.js'
    import { navigate } from '../../js/router.js'
    import { confirmDialog } from '../../js/dialog.js'
    import { globalSegments } from '../../js/views/progress-helpers.js'
    import { IC, TRACKER_TYPES, TRACKER_META, fmtDate } from '../../js/views/journal-render.js'

    let { appid } = $props()

    let pages   = $state<Page[]>([])
    let loading = $state(true)

    async function load() {
        const res = await api.pages.listByGame(appid).catch(() => [])
        pages = (res ?? []).filter((p: Page) => TRACKER_TYPES.includes(p.type))
    }

    async function newTracker(type: string, title: string, extra: Record<string, unknown> = {}) {
        const page = await api.pages.create({ type, title, appid: String(appid), ...extra })
        if (page) navigate(page.id)
    }

    async function deleteTracker(p: Page) {
        const ok = await confirmDialog(
            `Delete "${p.title}"?`,
            'This will permanently delete the tracker and all its data.',
            'Delete'
        )
        if (!ok) return
        await api.pages.remove(p.id)
        await load()
    }

    onMount(async () => {
        await load()
        loading = false
    })
</script>

{#if loading}
    <p class="page-loading">Loading…</p>
{:else}
<div class="gj-sub-header">
    <a href="/journal/{appid}" class="gj-sub-back">&#8592; Journal</a>
    <span class="gj-sub-title">Progress Trackers</span>
    <div class="gj-sub-actions">
        <button class="gj-btn" onclick={() => newTracker('progress', 'New Tracker')}>+ Progress</button>
        <button class="gj-btn" onclick={() => newTracker('progress-bars', 'New Multi-Bar')}>+ Multi-Bar</button>
        <button class="gj-btn" onclick={() => newTracker('counter', 'New Counter', { current: 0, target: 10 })}>+ Counter</button>
        <button class="gj-btn" onclick={() => newTracker('multi-counter', 'New Multi-Counter', { counters: [] })}>+ Multi-Counter</button>
    </div>
</div>

<div class="gj-full-list">
    {#if pages.length === 0}
        <p class="gj-no-data">No trackers yet. Create one to start tracking progress.</p>
    {/if}
    {#each pages as p (p.id)}
        {@const meta = TRACKER_META[p.type] ?? TRACKER_META['progress']}
        {@const segs = globalSegments(p)}
        <a class="gj-full-item" href="/{p.id}" onclick={(e) => { if ((e.target as Element)?.closest('[data-del]')) e.preventDefault() }}>
            <span class="gj-full-item-icon">{@html meta.icon()}</span>
            <div class="gj-full-item-body">
                <div class="gj-full-item-title">{p.title}</div>
                <div class="gj-full-item-meta">{meta.label} · Updated {fmtDate(p.updatedAt)}</div>
                <div class="gj-prog-segs gj-prog-segs--full">
                    {#if segs.length > 0}
                        {#each segs as s}
                            <div class="gj-prog-seg" style="background:{s.color}" title={s.label ?? ''}></div>
                        {/each}
                    {:else}
                        <div class="gj-prog-seg" style="background:rgba(255,255,255,0.07);flex:1"></div>
                    {/if}
                </div>
            </div>
            <button class="gj-full-item-del" data-del title="Delete tracker" onclick={(e) => { e.preventDefault(); e.stopPropagation(); deleteTracker(p) }}>&times;</button>
        </a>
    {/each}
</div>
{/if}
