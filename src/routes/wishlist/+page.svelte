<script lang="ts">
    import { onMount } from 'svelte'
    import WishlistPage from '$lib/svelte/wishlist/WishlistPage.svelte'

    let scrollContainer = $state<HTMLElement | null>(null)
    onMount(() => { scrollContainer = document.getElementById('main-content') })
</script>
<WishlistPage {scrollContainer} />
