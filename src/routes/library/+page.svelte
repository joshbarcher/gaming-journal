<script lang="ts">
    import { onMount } from 'svelte'
    import LibraryPage from '$lib/svelte/library/LibraryPage.svelte'

    let scrollContainer = $state<HTMLElement | null>(null)
    onMount(() => { scrollContainer = document.getElementById('main-content') })
</script>
<LibraryPage {scrollContainer} />
