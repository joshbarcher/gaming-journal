<script lang="ts">
    import { page } from '$app/state'
    import Calendar from '$lib/svelte/calendar/Calendar.svelte'
    let mode = $derived(page.url.searchParams.get('mode') === 'releases' ? 'releases' : 'play')
</script>
<Calendar {mode} />
