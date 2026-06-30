<script lang="ts">
    import JournalDashboard from './JournalDashboard.svelte'
    import JournalAchievements from './JournalAchievements.svelte'
    import JournalNotes from './JournalNotes.svelte'
    import JournalProgress from './JournalProgress.svelte'
    import JournalPages from './JournalPages.svelte'

    let { appid, sub } = $props()

    let gameName = $state('')

    $effect(() => {
        if (!sub || !appid) return
        fetch(`/relay/api/games/${appid}`)
            .then(r => r.ok ? r.json() : null)
            .then(g => { gameName = g?.name ?? '' })
            .catch(() => {})
    })
</script>

<svelte:head><title>{gameName ? `Journal — ${gameName}` : 'Journal'}</title></svelte:head>

{#if sub === 'achievements'}
    <div class="gj-sub-wrap">
        <JournalAchievements {appid} {gameName} />
    </div>
{:else if sub === 'notes'}
    <div class="gj-sub-wrap">
        <JournalNotes {appid} {gameName} />
    </div>
{:else if sub === 'progress'}
    <div class="gj-sub-wrap">
        <JournalProgress {appid} {gameName} />
    </div>
{:else if sub === 'pages'}
    <div class="gj-sub-wrap">
        <JournalPages {appid} {gameName} />
    </div>
{:else}
    <JournalDashboard {appid} />
{/if}
