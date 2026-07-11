<script lang="ts">
    import { page } from '$app/state'
    import ModDetailPage from '$lib/svelte/game/ModDetailPage.svelte'
</script>
{#key page.params.modId}
    <ModDetailPage appid={page.params.appid} modId={page.params.modId} />
{/key}
