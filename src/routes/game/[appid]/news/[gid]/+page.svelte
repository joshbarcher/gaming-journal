<script lang="ts">
    import { page } from '$app/state'
    import NewsArticlePage from '$lib/svelte/game/NewsArticlePage.svelte'
</script>
{#key page.params.gid}
    <NewsArticlePage appid={page.params.appid} gid={page.params.gid} />
{/key}
