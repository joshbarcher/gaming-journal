<script lang="ts">
    import { page } from '$app/state'
    import PcgwPage from '$lib/svelte/game/PcgwPage.svelte'
</script>
{#key page.params.appid}
    <PcgwPage appid={page.params.appid} />
{/key}
