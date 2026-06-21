<script lang="ts">
    import { page } from '$app/state'
    import GamePage from '$lib/svelte/game/GamePage.svelte'
</script>
{#key page.params.appid}
    <GamePage appid={page.params.appid} />
{/key}
