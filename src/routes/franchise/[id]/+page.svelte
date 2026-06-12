<script>
    import { page } from '$app/state'
    import Franchise from '$lib/svelte/franchise/Franchise.svelte'
</script>
<Franchise franchiseId={page.params.id} />
