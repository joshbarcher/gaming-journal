<script lang="ts">
    import Home from '$lib/svelte/home/Home.svelte'
    import type { HomeData } from './+page.server.js'

    let { data }: { data: HomeData } = $props()
</script>
<Home {data} />
