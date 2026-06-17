<script lang="ts">
    import type { MultiCounterPage, Counter } from '../../types.js'
    import { onMount } from 'svelte'
    import { api } from '../../js/api.js'
    import { confirmDialog } from '../../js/dialog.js'
    import { uuid } from '../../js/utils.js'
    import { refreshSidebarItem } from '../../js/sidebar.js'
    import { navigate } from '../../js/router.js'
    import { percentToColor } from '../../js/views/progress-helpers.js'
    import Breadcrumb from '../Breadcrumb.svelte'

    let { page: pageProp } = $props()

    let pd        = $state<MultiCounterPage>(JSON.parse(JSON.stringify(pageProp)))
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    let totalC    = $derived((pd.counters ?? []).reduce((s: number, c: Counter) => s + (c.current ?? 0), 0))
    let totalT    = $derived((pd.counters ?? []).reduce((s: number, c: Counter) => s + (c.target  ?? 0), 0))
    let globalPct = $derived(totalT > 0 ? Math.min(100, Math.round(totalC / totalT * 100)) : 0)

    function rowPct(c: Counter) {
        const t = c.target ?? 0
        return t > 0 ? Math.min(100, Math.round((c.current ?? 0) / t * 100)) : 0
    }

    async function deletePage() {
        const ok = await confirmDialog(`Delete "${pd.title}"?`, 'This will permanently delete the multi-counter and all its data.', 'Delete')
        if (!ok) return
        await api.pages.remove(pd.id)
        if (pd.appid) navigate(`journal/${pd.appid}`)
    }

    async function onTitleBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
        const t = (e.currentTarget.textContent ?? '').trim()
        if (!t || t === pd.title) { e.currentTarget.textContent = pd.title; return }
        pd.title = t
        const updated = await api.pages.update(pd.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    }

    async function onNameBlur(counterId: string, e: FocusEvent & { currentTarget: HTMLElement }) {
        const c = (pd.counters ?? []).find((x: Counter) => x.id === counterId)
        if (!c) return
        const v = (e.currentTarget.textContent ?? '').trim()
        if (!v) { e.currentTarget.textContent = c.name ?? ''; return }
        c.name = v
        await save()
    }

    async function onTargetBlur(counterId: string, e: FocusEvent & { currentTarget: HTMLElement }) {
        const c = (pd.counters ?? []).find((x: Counter) => x.id === counterId)
        if (!c) return
        const val = parseInt((e.currentTarget.textContent ?? '').trim(), 10)
        if (!isNaN(val) && val >= 0) {
            c.target = val
            await save()
        } else {
            e.currentTarget.textContent = String(c?.target ?? '?')
        }
    }

    function adjustRow(counterId: string, delta: number) {
        const c = (pd.counters ?? []).find((x: Counter) => x.id === counterId)
        if (!c) return
        c.current = Math.max(0, (c.current ?? 0) + delta)
        clearTimeout(saveTimer ?? undefined)
        saveTimer = setTimeout(save, 400)
    }

    async function addCounter() {
        const c = { id: uuid(), name: 'New Counter', current: 0, target: 10 }
        pd.counters = [...(pd.counters ?? []), c]
        await save()
        requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`.mcounter-row[data-id="${c.id}"] [data-role="name"]`)?.focus()
        })
    }

    async function deleteCounter(counterId: string) {
        pd.counters = (pd.counters ?? []).filter((x: Counter) => x.id !== counterId)
        await save()
    }

    function barDragAction(wrapEl: HTMLElement, counterId: string) {
        const found = (pd.counters ?? []).find((x: Counter) => x.id === counterId)
        if (!found) return { destroy: () => {} }
        const c: Counter = found

        function valueFromX(clientX: number) {
            const rect = wrapEl.getBoundingClientRect()
            const p    = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
            return Math.round(p * (c.target ?? 0))
        }

        function setLive(val: number) {
            c.current = Math.max(0, Math.min(val, c.target ?? val))
        }

        function onMousedown(e: MouseEvent) {
            e.preventDefault()
            setLive(valueFromX(e.clientX))

            const onMove = (ev: MouseEvent) => setLive(valueFromX(ev.clientX))
            const onUp   = () => {
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
                clearTimeout(saveTimer ?? undefined)
                saveTimer = setTimeout(save, 400)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
        }

        function onTouchstart(e: TouchEvent) {
            e.preventDefault()
            setLive(valueFromX(e.touches[0].clientX))

            const onMove = (ev: TouchEvent) => { ev.preventDefault(); setLive(valueFromX(ev.touches[0].clientX)) }
            const onEnd  = () => {
                wrapEl.removeEventListener('touchmove', onMove)
                wrapEl.removeEventListener('touchend', onEnd)
                clearTimeout(saveTimer ?? undefined)
                saveTimer = setTimeout(save, 400)
            }
            wrapEl.addEventListener('touchmove', onMove, { passive: false })
            wrapEl.addEventListener('touchend', onEnd)
        }

        wrapEl.addEventListener('mousedown', onMousedown)
        wrapEl.addEventListener('touchstart', onTouchstart, { passive: false })

        return {
            destroy() {
                wrapEl.removeEventListener('mousedown', onMousedown)
                wrapEl.removeEventListener('touchstart', onTouchstart)
            }
        }
    }

    async function save() {
        const updated = await api.pages.update(pd.id, { counters: pd.counters })
        if (updated) refreshSidebarItem(updated)
    }

    let gameName = $state('')
    onMount(async () => {
        if (!pd.appid) return
        try {
            const res = await fetch(`/relay/api/games/${pd.appid}`)
            if (res.ok) gameName = (await res.json())?.name ?? ''
        } catch { /* silent */ }
    })
</script>

<div class="gj-sub-header">
    {#if pd.appid}
        <Breadcrumb crumbs={[
            { label: 'Home', href: '/' },
            { label: gameName || '…', href: `/game/${pd.appid}` },
            { label: 'Journal', href: `/journal/${pd.appid}` },
            { label: 'Progress Trackers', href: `/journal/${pd.appid}/progress` },
            { label: pd.title },
        ]} />
    {/if}
    <div class="gj-sub-actions">
        <button class="gj-btn gj-btn--danger" onclick={deletePage}>Delete</button>
    </div>
</div>

<div class="page-header">
    <h1 class="page-title page-title--editable" contenteditable="true"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        onblur={onTitleBlur}>{pd.title}</h1>
    <p class="page-subtitle">Multi-Counter</p>
</div>

<div class="mcounter-global">
    <div class="mcounter-global-fill" style="width:{globalPct}%; background:{percentToColor(globalPct)}"></div>
    <span class="mcounter-global-label">{totalC} / {totalT} · {globalPct}%</span>
</div>

<div class="mcounter-list">
    {#each (pd.counters ?? []) as c (c.id)}
        {@const pct = rowPct(c)}
        <div class="mcounter-row" data-id={c.id}
             oncontextmenu={(e) => { e.preventDefault(); if (confirm(`Delete "${c.name ?? 'this counter'}"?`)) deleteCounter(c.id) }}>
            <div class="mcounter-row-body">
                <span class="mcounter-name" contenteditable="true" spellcheck="false" data-role="name"
                      onblur={(e) => onNameBlur(c.id, e)}
                      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}>{c.name ?? ''}</span>
                <span class="mcounter-val">
                    <span>{c.current ?? 0}</span>
                    <span class="counter-sep">/</span>
                    <span class="mcounter-target" contenteditable="true" spellcheck="false" data-role="target"
                          title="Click to edit target"
                          onblur={(e) => onTargetBlur(c.id, e)}
                          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}>{c.target ?? '?'}</span>
                </span>
            </div>
            <div class="mcounter-bar-row">
                <button class="counter-btn counter-btn--sm counter-btn--dec" aria-label="Decrease"
                        onclick={() => adjustRow(c.id, -1)}>−</button>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="mcounter-bar-wrap" use:barDragAction={c.id}>
                    <div class="mcounter-bar-fill" style="width:{pct}%; background:{percentToColor(pct)}"></div>
                </div>
                <button class="counter-btn counter-btn--sm counter-btn--inc" aria-label="Increase"
                        onclick={() => adjustRow(c.id, 1)}>+</button>
            </div>
        </div>
    {/each}
</div>

<button class="progress-add-btn" onclick={addCounter}>+ Add Counter</button>
