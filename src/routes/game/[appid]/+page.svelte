<script lang="ts">
    import { page } from '$app/state'
    import GamePage from '$lib/svelte/game/GamePage.svelte'
</script>
<GamePage appid={page.params.appid} />
