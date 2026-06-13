<script lang="ts">
    import { page } from '$app/state'
    import CommunityThread from '$lib/svelte/community/CommunityThread.svelte'
    const sub = $derived(page.url.searchParams.get('sub') ?? '')
</script>
<CommunityThread appid={page.params.appid} postId={page.params.postId} {sub} />
