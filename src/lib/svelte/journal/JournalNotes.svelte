<script lang="ts">
    import { onMount } from 'svelte'
    import type { ReviewNote } from '../../types.js'
    import { api } from '../../js/api.js'
    import { IC, fmtDate } from '../../js/views/journal-render.js'

    let { appid } = $props()

    let notes   = $state<ReviewNote[]>([])
    let loading = $state(true)
    let pinning = $state(false)
    let noteInput = $state('')

    let sorted = $derived.by(() => {
        const pinned  = notes.filter(n => n.pinned)
        const regular = notes.filter(n => !n.pinned)
        return [...pinned, ...regular]
    })

    async function refresh() {
        const r = await api.localReviews.get(appid).catch(() => null)
        notes = r?.notes ?? []
    }

    async function addNote() {
        const text = noteInput.trim()
        if (!text) return
        noteInput = ''
        const note = await api.localReviews.addNote(appid, text)
        if (pinning && note?.id) await api.localReviews.updateNote(appid, note.id, { pinned: true })
        await refresh()
    }

    async function togglePin(n: ReviewNote) {
        await api.localReviews.updateNote(appid, n.id, { pinned: !n.pinned })
        await refresh()
    }

    async function deleteNote(n: ReviewNote) {
        await api.localReviews.deleteNote(appid, n.id)
        await refresh()
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote() }
    }

    onMount(async () => {
        await refresh()
        loading = false
    })
</script>

{#if loading}
    <p class="page-loading">Loading…</p>
{:else}
<div class="gj-sub-header">
    <a href="/journal/{appid}" class="gj-sub-back">&#8592; Journal</a>
    <span class="gj-sub-title">Notes</span>
</div>

<div class="gj-add-note" style="margin-bottom:20px">
    <input class="gj-add-note-input" placeholder="New note…" bind:value={noteInput} onkeydown={handleKeydown}>
    <button class="gj-pin-toggle" class:active={pinning} title="Pin note" onclick={() => pinning = !pinning}>
        {@html IC.pin}
    </button>
    <button class="gj-btn gj-btn--accent" onclick={addNote}>Add</button>
</div>

{#if sorted.length > 0}
    <div class="gj-notes-full-grid">
        {#each sorted as n (n.id)}
            <div class="gj-note-full-card" class:gj-note-full-card--pinned={n.pinned}>
                {n.text}
                <div class="gj-note-full-btns">
                    <button class="gj-note-btn" title={n.pinned ? 'Unpin' : 'Pin'} onclick={() => togglePin(n)}>
                        {@html IC.pin}
                    </button>
                    <button class="gj-note-btn gj-note-btn--del" title="Delete" onclick={() => deleteNote(n)}>&times;</button>
                </div>
                <div class="gj-note-date">{fmtDate(n.createdAt)}</div>
            </div>
        {/each}
    </div>
{:else}
    <p class="gj-no-data">No notes yet.</p>
{/if}
{/if}
