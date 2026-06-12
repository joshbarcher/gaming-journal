<script>
    import { page } from '$app/state'
    import CommunityPage from '$lib/svelte/community/CommunityPage.svelte'
</script>
<CommunityPage appid={page.params.appid} />
