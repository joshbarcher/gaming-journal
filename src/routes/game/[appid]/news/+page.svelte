<script lang="ts">
    import { page } from '$app/state'
    import NewsPage from '$lib/svelte/game/NewsPage.svelte'
</script>
{#key page.params.appid}
    <NewsPage appid={page.params.appid} />
{/key}
