<script lang="ts">
    import { page } from '$app/state'
    import GuidesList from '$lib/svelte/journal/guide/GuidesList.svelte'
</script>

<GuidesList appid={page.params.appid} />
