<script lang="ts">
    import { page } from '$app/state'
    import GuideViewer from '$lib/svelte/journal/guide/GuideViewer.svelte'
</script>

<GuideViewer
    appid={page.params.appid}
    source={page.params.source}
    section={page.params.section ?? null}
/>
