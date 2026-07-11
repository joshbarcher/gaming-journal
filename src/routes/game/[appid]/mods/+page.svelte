<script lang="ts">
    import { page } from '$app/state'
    import ModsPage from '$lib/svelte/game/ModsPage.svelte'
</script>
{#key page.params.appid}
    <ModsPage appid={page.params.appid} />
{/key}
