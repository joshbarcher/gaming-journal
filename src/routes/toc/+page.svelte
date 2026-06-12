<script>
    import { store } from '$lib/sidebar.svelte.js'
    import Toc from '$lib/svelte/toc/Toc.svelte'
</script>
<Toc pages={store.pages} />
