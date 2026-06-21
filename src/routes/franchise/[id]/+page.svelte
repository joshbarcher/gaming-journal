<script lang="ts">
    import { page } from '$app/state'
    import Franchise from '$lib/svelte/franchise/Franchise.svelte'
</script>
{#key page.params.id}
    <Franchise franchiseId={page.params.id} />
{/key}
