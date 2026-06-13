<script lang="ts">
    import type { NotesPage, NoteEntry } from '../../types.js'
    import { api } from '../../js/api.js'
    import { uuid } from '../../js/utils.js'
    import { refreshSidebarItem } from '../../js/sidebar.js'

    let { page: pageProp } = $props()

    let pd          = $state<NotesPage>(JSON.parse(JSON.stringify(pageProp)))
    let input       = $state('')
    let editingId   = $state<string | null>(null)

    async function onTitleBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
        const t = (e.currentTarget.textContent ?? '').trim()
        if (!t || t === pd.title) { e.currentTarget.textContent = pd.title; return }
        pd.title = t
        const updated = await api.pages.update(pd.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    }

    async function addNote() {
        const text = input.trim()
        if (!text) return
        const note = { id: uuid(), text, createdAt: new Date().toISOString() }
        pd.notes = [note, ...(pd.notes ?? [])]
        input = ''
        await save()
    }

    async function onCardBlur(noteId: string, e: FocusEvent & { currentTarget: HTMLElement }) {
        editingId = null
        const newText = (e.currentTarget.textContent ?? '').trim()
        const note = (pd.notes ?? []).find((n: NoteEntry) => n.id === noteId)
        if (!note) return
        if (!newText) { e.currentTarget.textContent = note.text; return }
        if (newText === note.text) return
        note.text = newText
        await save()
    }

    async function deleteNote(noteId: string) {
        pd.notes = (pd.notes ?? []).filter((n: NoteEntry) => n.id !== noteId)
        await save()
    }

    async function save() {
        const updated = await api.pages.update(pd.id, { notes: pd.notes })
        if (updated) refreshSidebarItem(updated)
    }
</script>

<div class="page-header">
    <h1 class="page-title page-title--editable" contenteditable="true"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        onblur={onTitleBlur}>{pd.title}</h1>
    <p class="page-subtitle">(Note)</p>
</div>

<div class="notes-input-wrap">
    <textarea class="notes-input" placeholder="Notes…" aria-label="New note"
              bind:value={input}
              onkeydown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); addNote() } }}></textarea>
    <p class="notes-input-hint">Ctrl + Enter to add</p>
</div>

<div class="notes-grid">
    {#each (pd.notes ?? []) as note (note.id)}
        <div class="notes-card" class:notes-card--editing={editingId === note.id} data-id={note.id}>
            <p class="notes-card-text" contenteditable="true" spellcheck="true"
               onfocus={() => editingId = note.id}
               onblur={(e) => onCardBlur(note.id, e)}
               onkeydown={(e) => {
                   if (e.key === 'Escape') { e.currentTarget.textContent = note.text; e.currentTarget.blur() }
                   if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); e.currentTarget.blur() }
               }}>{note.text}</p>
            <button class="notes-card-delete" aria-label="Delete note"
                    onmousedown={(e) => e.preventDefault()}
                    onclick={() => deleteNote(note.id)}>&times;</button>
        </div>
    {/each}
</div>
