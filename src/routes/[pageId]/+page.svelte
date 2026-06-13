<script lang="ts">
    import { onMount } from 'svelte'
    import { page } from '$app/state'

    const PAGE_COMPONENTS = {
        list:             () => import('$lib/svelte/list/ListPage.svelte'),
        progress:         () => import('$lib/svelte/progress-tracker/Progress.svelte'),
        'progress-bars':  () => import('$lib/svelte/progress/ProgressBars.svelte'),
        notes:            () => import('$lib/svelte/notes/Notes.svelte'),
        page:             () => import('$lib/svelte/page-editor/PageEditor.svelte'),
        counter:          () => import('$lib/svelte/counter/Counter.svelte'),
        'multi-counter':  () => import('$lib/svelte/multi-counter/MultiCounter.svelte'),
    }

    let Component = $state<any>(null)
    let pageData  = $state<any>(null)
    let notFound  = $state(false)

    onMount(async () => {
        try {
            const res = await fetch(`/api/pages/${page.params.pageId}`)
            if (!res.ok) { notFound = true; return }
            pageData = await res.json()
            const loader = PAGE_COMPONENTS[pageData.type as keyof typeof PAGE_COMPONENTS]
            if (loader) Component = (await loader()).default
        } catch {
            notFound = true
        }
    })
</script>

{#if Component}
    <Component page={pageData} />
{:else if notFound}
    <p class="page-error">Page not found.</p>
{:else}
    <p class="page-loading">Loading…</p>
{/if}
