<script>
    import JournalDashboard from './JournalDashboard.svelte'
    import JournalAchievements from './JournalAchievements.svelte'
    import JournalNotes from './JournalNotes.svelte'
    import JournalProgress from './JournalProgress.svelte'
    import JournalPages from './JournalPages.svelte'

    let { appid, sub } = $props()
</script>

{#if sub === 'achievements'}
    <JournalAchievements {appid} />
{:else if sub === 'notes'}
    <JournalNotes {appid} />
{:else if sub === 'progress'}
    <JournalProgress {appid} />
{:else if sub === 'pages'}
    <JournalPages {appid} />
{:else}
    <JournalDashboard {appid} />
{/if}
