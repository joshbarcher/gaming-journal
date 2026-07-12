<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { Settings } from '../../types.js'
    import { adultContent } from '$lib/adult-content.svelte.js'

    let loading    = $state(true)
    let error      = $state<string | null>(null)
    let settings   = $state<Partial<Settings>>({})
    let flagCounts = $state({ childLocked: 0, filtered: 0 })

    let showBlocklist = $state(false)
    let newTerm       = $state('')

    // ── Nexus adult-mod image backfill (session + resumable job) ────────────────────
    interface NexusSession { present: boolean; status: string; capturedAt?: string | null }
    interface Backfill { status: string; total: number; done: number; added: number;
                         currentGame?: string | null; pausedReason?: string | null }
    interface Backfill2 { perGameCap?: number }
    let nexusSession = $state<NexusSession | null>(null)
    let backfill     = $state<(Backfill & Backfill2) | null>(null)
    let backfillBusy = $state(false)
    let bfTimer: ReturnType<typeof setInterval> | null = null

    const sessionActive = $derived(nexusSession?.present && nexusSession.status === 'active')
    const bfRunning = $derived(backfill?.status === 'running' || backfill?.status === 'building')
    const bfPct = $derived(backfill?.total ? Math.round((backfill.done / backfill.total) * 100) : 0)

    async function loadNexusStatus() {
        try {
            const [s, b] = await Promise.all([
                fetch('/relay/api/nexus/session').then(r => r.ok ? r.json() : null),
                fetch('/relay/api/nexus/backfill').then(r => r.ok ? r.json() : null),
            ])
            nexusSession = s; backfill = b
            if ((b?.status === 'running' || b?.status === 'building') && !bfTimer) startBfPoll()
        } catch { /* leave as-is */ }
    }
    function startBfPoll() { bfTimer ??= setInterval(pollBackfill, 2000) }
    function stopBfPoll()  { if (bfTimer) { clearInterval(bfTimer); bfTimer = null } }
    async function pollBackfill() {
        try {
            const b = await fetch('/relay/api/nexus/backfill').then(r => r.ok ? r.json() : null)
            if (b) backfill = b
            if (b && b.status !== 'running' && b.status !== 'building') { stopBfPoll(); loadNexusStatus() }
        } catch { /* keep last */ }
    }
    async function backfillAction(action: 'start' | 'pause') {
        backfillBusy = true
        try {
            const r = await fetch('/relay/api/nexus/backfill', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
            })
            if (r.ok) { backfill = await r.json(); if (bfRunning) startBfPoll() }
        } finally { backfillBusy = false }
    }
    function fmtDate(s?: string | null) {
        if (!s) return ''
        try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '' }
    }
    onDestroy(stopBfPoll)

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
        loadNexusStatus()
    })

    // Every content-filter toggle in the UI means the same thing: ON = hide, OFF = show.
    // Some underlying settings are stored the opposite way ("show X" = true means visible),
    // so those rows pass invert=true — the UI checkbox is the negation of the stored value.
    async function onToggle(key: keyof Settings, checked: boolean, invert = false) {
        const prev = settings[key]
        settings[key] = invert ? !checked : checked
        // Keep the shared adult-content mirror in sync so mod thumbnails re-blur live.
        if (key === 'hideAdultContent') adultContent.hide = settings[key] as boolean
        try {
            const res = await fetch('/api/settings', {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ [key]: settings[key] }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
        } catch {
            settings[key] = prev
            if (key === 'hideAdultContent') adultContent.hide = prev as boolean
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
                Every toggle here works the same way: <strong>on hides, off shows</strong>.
                Games flagged as Child Lock or Filtered are hidden by default — turn a toggle off to reveal them.
            </p>

            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">
                        Hide Child Locked Games
                        {#if flagCounts.childLocked > 0}
                            <span class="settings-filter-count">{flagCounts.childLocked} game{flagCounts.childLocked === 1 ? '' : 's'}</span>
                        {/if}
                    </span>
                    <span class="settings-toggle-desc">Hide games flagged with the child lock from library, wishlist, and all other lists.</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={!settings.showChildLocked}
                           onchange={(e) => onToggle('showChildLocked', e.currentTarget.checked, true)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>

            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">
                        Hide Filtered Games
                        {#if flagCounts.filtered > 0}
                            <span class="settings-filter-count">{flagCounts.filtered} game{flagCounts.filtered === 1 ? '' : 's'}</span>
                        {/if}
                    </span>
                    <span class="settings-toggle-desc">Hide games flagged as filtered (political themes, personal preference, etc.).</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={!settings.showFiltered}
                           onchange={(e) => onToggle('showFiltered', e.currentTarget.checked, true)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>

            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">Hide Software &amp; Tools</span>
                    <span class="settings-toggle-desc">Hide apps flagged as Software / Tool (e.g. Wallpaper Engine) so they don't clutter your game collection.</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={!settings.showSoftware}
                           onchange={(e) => onToggle('showSoftware', e.currentTarget.checked, true)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>

            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">Hide Filtered Discovery Games</span>
                    <span class="settings-toggle-desc">Hide games matching your Discovery Title Filter from the Discovery page and home page mosaic. Turn off to see all results unfiltered.</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={settings.discoverFiltersEnabled}
                           onchange={(e) => onToggle('discoverFiltersEnabled', e.currentTarget.checked)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>

            <label class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">Hide Adult-Only Content</span>
                    <span class="settings-toggle-desc">Hide games Steam flags as Adult Only Sexual Content from Discovery and the home page mosaic. Lighter content (nudity in an otherwise mainstream title, e.g. Cyberpunk 2077) isn't affected.</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={settings.hideAdultContent}
                           onchange={(e) => onToggle('hideAdultContent', e.currentTarget.checked)}>
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
                    <span class="settings-toggle-label">Hide Unavailable Games</span>
                    <span class="settings-toggle-desc">Hide wishlist items that are no longer available on the Steam store.</span>
                </div>
                <div class="settings-toggle-switch">
                    <input type="checkbox" checked={settings.hideUnavailable}
                           onchange={(e) => onToggle('hideUnavailable', e.currentTarget.checked)}>
                    <span class="settings-toggle-track"></span>
                </div>
            </label>
        </section>

        <section class="settings-section">
            <h2 class="settings-section-title">Mod Images (Nexus)</h2>
            <p class="settings-section-desc">
                Adult (18+) mods on Nexus are gated behind a login, so their image galleries can't be fetched
                anonymously. Connect a Nexus session (with adult content enabled), then run a one-time backfill to
                mirror every adult mod's images locally — after that they're served from your own server.
            </p>

            <div class="settings-toggle-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">
                        Nexus session
                        {#if sessionActive}
                            <span class="settings-filter-count nx-ok">Connected</span>
                        {:else if nexusSession?.status === 'expired'}
                            <span class="settings-filter-count nx-warn">Expired</span>
                        {:else}
                            <span class="settings-filter-count">Not connected</span>
                        {/if}
                    </span>
                    <span class="settings-toggle-desc">
                        {#if sessionActive}
                            Captured {fmtDate(nexusSession?.capturedAt)}. Adult mod images can be fetched.
                        {:else}
                            Run <code>node scripts/capture-nexus-session.mjs</code> in the relay repo to log in and capture a session{#if nexusSession?.status === 'expired'}, then Resume below{/if}.
                        {/if}
                    </span>
                </div>
            </div>

            <div class="settings-blocklist-row">
                <div class="settings-toggle-text">
                    <span class="settings-toggle-label">
                        Adult image backfill
                        {#if backfill && backfill.total}
                            <span class="settings-filter-count">{backfill.done.toLocaleString()} / {backfill.total.toLocaleString()}</span>
                        {/if}
                    </span>
                    <span class="settings-toggle-desc">
                        {#if backfill?.status === 'building'}
                            Enumerating adult mods across your games…
                        {:else if backfill?.status === 'running'}
                            Fetching{backfill.currentGame ? ` — ${backfill.currentGame}` : ''} · {backfill.added.toLocaleString()} images saved
                        {:else if backfill?.status === 'paused'}
                            Paused{backfill.pausedReason === 'session-expired' ? ' — session expired; reconnect, then Resume' : ''} · {backfill.done.toLocaleString()}/{backfill.total.toLocaleString()} done
                        {:else if backfill?.status === 'done'}
                            Done — {backfill.added.toLocaleString()} images across {backfill.total.toLocaleString()} adult mods
                        {:else}
                            Scrapes the top {(backfill?.perGameCap ?? 500).toLocaleString()} adult mods per game (slow &amp; gentle, resumable). Needs a connected session.
                        {/if}
                    </span>
                </div>
                {#if bfRunning}
                    <button class="settings-reveal-btn" disabled={backfillBusy} onclick={() => backfillAction('pause')}>Pause</button>
                {:else}
                    <button class="settings-reveal-btn" disabled={backfillBusy || !sessionActive} onclick={() => backfillAction('start')}>
                        {backfill?.status === 'paused' ? 'Resume' : 'Start'}
                    </button>
                {/if}
            </div>
            {#if backfill && backfill.total > 0 && backfill.status !== 'idle'}
                <div class="nx-progress"><div class="nx-progress-bar" style="width:{bfPct}%"></div></div>
            {/if}
        </section>
    </div>
{/if}

<style>
    .nx-ok   { color: #1a160a; background: var(--clr-accent); }
    .nx-warn { color: #1a160a; background: #e0a33a; }
    .nx-progress { height: 6px; border-radius: 4px; background: var(--clr-bg-raised); overflow: hidden; margin-top: 10px; }
    .nx-progress-bar { height: 100%; background: var(--clr-accent); transition: width 0.4s ease; }
    .settings-toggle-desc code { background: var(--clr-bg-raised); padding: 1px 6px; border-radius: 4px; font-size: 0.92em; }
</style>
