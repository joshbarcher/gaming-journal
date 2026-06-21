<script lang="ts">
    import { onMount } from 'svelte'
    import type { Settings } from '../../types.js'

    let loading    = $state(true)
    let error      = $state<string | null>(null)
    let settings   = $state<Partial<Settings>>({})
    let flagCounts = $state({ childLocked: 0, filtered: 0 })

    let showBlocklist = $state(false)
    let newTerm       = $state('')

    onMount(async () => {
        try {
            const [settingsRes, flagsRes] = await Promise.all([
                fetch('/api/settings'),
                fetch('/api/flags').catch(() => null),
            ])
            if (!settingsRes.ok) throw new Error(`HTTP ${settingsRes.status}`)
            settings = await settingsRes.json()

            const flags   = flagsRes?.ok ? await flagsRes.json() : {}
            const entries: { childLock?: boolean; filtered?: boolean }[] = Object.values(flags)
            flagCounts = {
                childLocked: entries.filter(f => f?.childLock).length,
                filtered:    entries.filter(f => f?.filtered).length,
            }
        } catch (err) {
            error = (err as Error).message
        }
        loading = false
    })

    async function onToggle(key: keyof Settings, checked: boolean) {
        const prev = settings[key]
        settings[key] = key === 'hideUnavailable' ? !checked : checked
        try {
            const res = await fetch('/api/settings', {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ [key]: settings[key] }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
        } catch {
            settings[key] = prev
        }
    }

    async function saveBlocklist(list: string[]) {
        const prev = settings.titleBlocklist
        settings.titleBlocklist = list
        try {
            const res = await fetch('/api/settings', {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ titleBlocklist: list }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            try { localStorage.setItem('disc-title-blocklist', JSON.stringify(list)) } catch {}
        } catch {
            settings.titleBlocklist = prev
        }
    }

    async function addTerm() {
        const term = newTerm.trim().toLowerCase()
        if (!term) return
        await saveBlocklist([...(settings.titleBlocklist ?? []), term])
        newTerm = ''
    }

    async function removeTerm(i: number) {
        await saveBlocklist((settings.titleBlocklist ?? []).filter((_, idx) => idx !== i))
    }
</script>

{#if loading}
    <p class="page-loading">Loading settings…</p>
{:else if error}
    <p class="page-error">Failed to load settings: {error}</p>
{:else}
    <div class="page-header">
        <h1 class="page-title">Settings</h1>
    </div>
    <div class="settings-body">
        <section class="settings-section">
            <h2 class="settings-section-title">Content Filters</h2>
            <p class="settings-section-desc">
                Games flagged as Child Lock or Filtered are hidden from all lists by default.
                Toggle these on to reveal them.
            </p>

            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">
                        Show Child Locked Games
                        {#if flagCounts.childLocked > 0}
                            <span class="settings-filter-count">{flagCounts.childLocked} game{flagCounts.childLocked === 1 ? '' : 's'}</span>
                        {/if}
                    </span>
                    <span class="settings-toggle-desc">Reveal games flagged with the child lock in library, wishlist, and all other lists.</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={settings.showChildLocked}
                           onchange={(e) => onToggle('showChildLocked', e.currentTarget.checked)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>

            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">
                        Show Filtered Games
                        {#if flagCounts.filtered > 0}
                            <span class="settings-filter-count">{flagCounts.filtered} game{flagCounts.filtered === 1 ? '' : 's'}</span>
                        {/if}
                    </span>
                    <span class="settings-toggle-desc">Reveal games flagged as filtered (political themes, personal preference, etc.).</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={settings.showFiltered}
                           onchange={(e) => onToggle('showFiltered', e.currentTarget.checked)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>

            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">Enable Discovery Filters</span>
                    <span class="settings-toggle-desc">Apply the title blocklist to the Discovery page and home page mosaic. Turn off to see all results unfiltered.</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={settings.discoverFiltersEnabled}
                           onchange={(e) => onToggle('discoverFiltersEnabled', e.currentTarget.checked)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>

            <div class="settings-blocklist-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">
                        Discovery Title Filter
                        {#if (settings.titleBlocklist?.length ?? 0) > 0}
                            <span class="settings-filter-count">{settings.titleBlocklist!.length} term{settings.titleBlocklist!.length === 1 ? '' : 's'}</span>
                        {/if}
                    </span>
                    <span class="settings-toggle-desc">Hide games whose titles contain any of these words or phrases from Discovery and the home page mosaic.</span>
                </div>
                <button class="settings-reveal-btn" onclick={() => showBlocklist = !showBlocklist}>
                    {showBlocklist ? 'Hide' : 'Manage'}
                </button>
            </div>
            {#if showBlocklist}
            <div class="settings-blocklist-panel">
                {#if settings.titleBlocklist?.length}
                    <div class="settings-blocklist-tags">
                        {#each settings.titleBlocklist as term, i}
                            <span class="settings-blocklist-tag">
                                {term}
                                <button class="settings-blocklist-tag-remove" onclick={() => removeTerm(i)} aria-label="Remove {term}">×</button>
                            </span>
                        {/each}
                    </div>
                {:else}
                    <p class="settings-blocklist-empty">No terms yet. Add one below.</p>
                {/if}
                <div class="settings-blocklist-add-row">
                    <input
                        class="settings-blocklist-input"
                        type="text"
                        placeholder="Add a word or phrase…"
                        bind:value={newTerm}
                        onkeydown={(e) => { if (e.key === 'Enter') addTerm() }}
                    >
                    <button class="settings-blocklist-add-btn" onclick={addTerm}>Add</button>
                </div>
            </div>
            {/if}
        </section>

        <section class="settings-section">
            <h2 class="settings-section-title">Wishlist</h2>
            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">Show Unavailable Games</span>
                    <span class="settings-toggle-desc">Show wishlist items that are no longer available on the Steam store.</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={!settings.hideUnavailable}
                           onchange={(e) => onToggle('hideUnavailable', e.currentTarget.checked)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>
        </section>
    </div>
{/if}
