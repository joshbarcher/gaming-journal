<script lang="ts">
    import { page } from '$app/state'
    import GameJournal from '$lib/svelte/journal/GameJournal.svelte'
</script>
<GameJournal appid={page.params.appid} sub={page.params.sub ?? null} />
