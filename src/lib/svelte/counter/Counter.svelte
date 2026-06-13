<script lang="ts">
    import type { CounterPage } from '../../types.js'
    import { api } from '../../js/api.js'
    import { confirmDialog } from '../../js/dialog.js'
    import { refreshSidebarItem } from '../../js/sidebar.js'
    import { navigate } from '../../js/router.js'
    import { percentToColor } from '../../js/views/progress-helpers.js'

    let { page: pageProp } = $props()

    let pd        = $state<CounterPage>(JSON.parse(JSON.stringify(pageProp)))
    let trackEl: HTMLElement | null   = null
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    let pct   = $derived(pd.target > 0 ? Math.min(100, Math.round((pd.current ?? 0) / pd.target * 100)) : 0)
    let color = $derived(percentToColor(pct))

    async function deletePage() {
        const ok = await confirmDialog(`Delete "${pd.title}"?`, 'This will permanently delete the counter and all its data.', 'Delete')
        if (!ok) return
        await api.pages.remove(pd.id)
        if (pd.appid) navigate(`journal/${pd.appid}`)
    }

    async function onTitleBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
        const t = (e.currentTarget.textContent ?? '').trim()
        if (!t) { e.currentTarget.textContent = pd.title; return }
        if (t === pd.title) return
        pd.title = t
        const updated = await api.pages.update(pd.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    }

    async function onDescBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
        const d = (e.currentTarget.textContent ?? '').trim()
        if (d === (pd.description ?? '')) return
        pd.description = d
        await api.pages.update(pd.id, { description: d })
    }

    async function onTargetBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
        const val = parseInt((e.currentTarget.textContent ?? '').trim(), 10)
        if (!isNaN(val) && val > 0) {
            pd.target = val
            await save()
        } else {
            e.currentTarget.textContent = String(pd.target ?? '?')
        }
    }

    function adjust(delta: number) {
        pd.current = Math.max(0, (pd.current ?? 0) + delta)
        clearTimeout(saveTimer ?? undefined)
        saveTimer = setTimeout(save, 400)
    }

    function valueFromX(clientX: number) {
        if (!trackEl) return 0
        const rect = trackEl.getBoundingClientRect()
        const p    = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        return Math.round(p * (pd.target ?? 0))
    }

    function onTrackMousedown(e: MouseEvent) {
        if ((e.target as Element)?.closest('[data-role="target"]')) return
        e.preventDefault()
        pd.current = Math.max(0, Math.min(valueFromX(e.clientX), pd.target ?? 0))

        const onMove = (ev: MouseEvent) => { pd.current = Math.max(0, Math.min(valueFromX(ev.clientX), pd.target ?? 0)) }
        const onUp   = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            save()
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    function onTrackTouchstart(e: TouchEvent) {
        if ((e.target as Element)?.closest('[data-role="target"]')) return
        e.preventDefault()
        pd.current = Math.max(0, Math.min(valueFromX(e.touches[0].clientX), pd.target ?? 0))

        const onMove = (ev: TouchEvent) => { ev.preventDefault(); pd.current = Math.max(0, Math.min(valueFromX(ev.touches[0].clientX), pd.target ?? 0)) }
        const onEnd  = () => {
            trackEl?.removeEventListener('touchmove', onMove)
            trackEl?.removeEventListener('touchend', onEnd)
            save()
        }
        trackEl?.addEventListener('touchmove', onMove, { passive: false })
        trackEl?.addEventListener('touchend', onEnd)
    }

    async function save() {
        const updated = await api.pages.update(pd.id, { current: pd.current, target: pd.target })
        if (updated) refreshSidebarItem(updated)
    }
</script>

<div class="page-header">
    <div style="display:flex;align-items:center;margin-bottom:8px">
        {#if pd.appid}
            <a class="gj-sub-back" href="/journal/{pd.appid}"
               onclick={(e) => { e.preventDefault(); navigate(`journal/${pd.appid}`) }}>← Journal</a>
        {/if}
        <button class="gj-btn gj-btn--danger" style="margin-left:auto" onclick={deletePage}>Delete</button>
    </div>
    <p class="page-subtitle">Counter</p>
</div>

<div class="counter-wrap">
    <div class="counter-big-title" contenteditable="true" spellcheck="false"
         onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
         onblur={onTitleBlur}>{pd.title}</div>
    <p class="counter-desc" contenteditable="true" data-placeholder="Add a description…" spellcheck="false"
       onblur={onDescBlur}
       onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() } }}>{pd.description ?? ''}</p>
    <div class="counter-bar-outer">
        <button class="counter-btn counter-btn--dec" aria-label="Decrease" onclick={() => adjust(-1)}>−</button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="counter-track-wrap" bind:this={trackEl}
             onmousedown={onTrackMousedown}
             ontouchstart={onTrackTouchstart}>
            <div class="counter-track-fill" style="width:{pct}%; background:{color}"></div>
            <span class="counter-overlay-val">
                <span>{pd.current ?? 0}</span><span class="counter-overlay-sep"> / </span><span
                      class="counter-overlay-target" contenteditable="true" data-role="target"
                      title="Click to edit target" spellcheck="false"
                      onblur={onTargetBlur}
                      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } e.stopPropagation() }}>{pd.target ?? '?'}</span>
            </span>
            <span class="counter-overlay-pct">{pct}%</span>
        </div>
        <button class="counter-btn counter-btn--inc" aria-label="Increase" onclick={() => adjust(1)}>+</button>
    </div>
</div>
