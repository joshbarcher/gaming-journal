<script lang="ts">
    import { page } from '$app/state'
    import CommunityPage from '$lib/svelte/community/CommunityPage.svelte'
</script>
{#key page.params.appid}
    <CommunityPage appid={page.params.appid} />
{/key}
