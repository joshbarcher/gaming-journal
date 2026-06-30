<script lang="ts">
    import Home from '$lib/svelte/home/Home.svelte'
    import type { HomeData } from './+page.server.js'

    let { data }: { data: HomeData } = $props()
</script>
<svelte:head><title>Game Journal</title></svelte:head>
<Home {data} />
