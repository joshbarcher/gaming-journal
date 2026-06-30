<script lang="ts">
    import { store } from '$lib/sidebar.svelte.js'
    import Toc from '$lib/svelte/toc/Toc.svelte'
</script>
<svelte:head><title>Table of Contents</title></svelte:head>
<Toc pages={store.pages} />
