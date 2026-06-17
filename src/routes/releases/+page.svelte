<script lang="ts">
    import { goto } from '$app/navigation'
    import { onMount } from 'svelte'
    onMount(() => goto('/calendar?mode=releases', { replaceState: true }))
</script>
