<script lang="ts">
    import { onMount } from 'svelte'
    import JournalDashboard from './JournalDashboard.svelte'
    import JournalAchievements from './JournalAchievements.svelte'
    import JournalNotes from './JournalNotes.svelte'
    import JournalProgress from './JournalProgress.svelte'
    import JournalPages from './JournalPages.svelte'

    let { appid, sub } = $props()

    let gameName = $state('')

    onMount(async () => {
        if (!sub) return  // JournalDashboard fetches its own game data
        try {
            const res = await fetch(`/relay/api/games/${appid}`)
            if (res.ok) {
                const g = await res.json()
                gameName = g?.name ?? ''
            }
        } catch { /* silent */ }
    })
</script>

{#if sub === 'achievements'}
    <JournalAchievements {appid} {gameName} />
{:else if sub === 'notes'}
    <JournalNotes {appid} {gameName} />
{:else if sub === 'progress'}
    <JournalProgress {appid} {gameName} />
{:else if sub === 'pages'}
    <JournalPages {appid} {gameName} />
{:else}
    <JournalDashboard {appid} />
{/if}
