<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte'
    import { goto } from '$app/navigation'
    import Breadcrumb from '../../Breadcrumb.svelte'
    import GuideBlockRenderer from './GuideBlockRenderer.svelte'

    let { appid, source, section }: {
        appid: string
        source: string
        section: string | null
    } = $props()

    // ── State ──────────────────────────────────────────────────────────────────

    let gameName     = $state('')
    let meta         = $state<any>(null)
    let blocks       = $state<any[]>([])
    let currentSlug  = $state<string | null>(null)
    let loading      = $state(true)
    let loadingSection = $state(false)
    let error        = $state<string | null>(null)

    // ── Page scroll (left gutter arrows + keyboard ↑↓) ────────────────────────

    let contentEl = $state<HTMLElement | null>(null)

    function scrollPage(delta: 1 | -1) {
        const scrollEl = document.getElementById('main-content')
        if (!scrollEl) return
        scrollEl.scrollBy({ top: delta * scrollEl.clientHeight * 0.85, behavior: 'smooth' })
    }

    // ── Image modal ────────────────────────────────────────────────────────────

    let modalEl: HTMLElement | null = null

    function openImageModal(url: string) {
        if (!modalEl) {
            modalEl = document.createElement('div')
            modalEl.className = 'gv-img-modal'
            modalEl.innerHTML = `
                <div class="gv-img-modal-backdrop"></div>
                <img class="gv-img-modal-img" src="" alt="Guide image">
                <button class="gv-img-modal-close" aria-label="Close">✕</button>
            `
            document.body.appendChild(modalEl)
            modalEl.addEventListener('click', closeImageModal)
        }
        ;(modalEl.querySelector('.gv-img-modal-img') as HTMLImageElement).src = url
        modalEl.classList.add('gv-img-modal--open')
    }

    function closeImageModal() {
        modalEl?.classList.remove('gv-img-modal--open')
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape' && modalEl?.classList.contains('gv-img-modal--open')) {
            closeImageModal()
            return
        }
        if (e.key === 'ArrowDown' && !modalEl?.classList.contains('gv-img-modal--open')) {
            e.preventDefault()
            scrollPage(1)
        } else if (e.key === 'ArrowUp' && !modalEl?.classList.contains('gv-img-modal--open')) {
            e.preventDefault()
            scrollPage(-1)
        }
    }

    // ── TOC tree ───────────────────────────────────────────────────────────────

    let openGroups = $state<Set<string>>(new Set())

    function toggleGroup(label: string) {
        const next = new Set(openGroups)
        if (next.has(label)) next.delete(label)
        else next.add(label)
        openGroups = next
    }

    // ── Navigation ─────────────────────────────────────────────────────────────

    function navTo(slug: string) {
        goto(`/journal/${appid}/guides/${source}/${encodeURIComponent(slug)}`)
    }

    function isActive(slug: string): boolean {
        return slug === currentSlug
    }

    // ── Data loading ───────────────────────────────────────────────────────────

    async function loadMeta() {
        const [metaRes, gameRes] = await Promise.allSettled([
            fetch(`/relay/api/guides/${appid}/${source}/meta`).then(r => r.ok ? r.json() : null),
            fetch(`/relay/api/games/${appid}`).then(r => r.ok ? r.json() : null),
        ])
        meta     = (metaRes as PromiseFulfilledResult<any>).value
        gameName = (gameRes as PromiseFulfilledResult<any>).value?.name ?? ''
        if (!meta) throw new Error('Guide not found')
    }

    async function loadSection(slug: string) {
        loadingSection = true
        try {
            const data = await fetch(`/relay/api/guides/${appid}/${source}/${encodeURIComponent(slug)}`).then(r => r.ok ? r.json() : null)
            blocks = data ?? []
            currentSlug = slug
        } finally {
            loadingSection = false
        }
        await tick()
        document.getElementById('main-content')?.scrollTo({ top: 0 })
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    onMount(async () => {
        try {
            await loadMeta()
            const firstSlug = section ?? meta?.pages?.[0]?.slug ?? meta?.nav?.[0]?.slug
            if (!firstSlug) throw new Error('No sections in guide')
            await loadSection(firstSlug)
        } catch (e) {
            error = (e as Error).message
        } finally {
            loading = false
        }

        document.addEventListener('keydown', onKeyDown)
    })

    onDestroy(() => {
        document.removeEventListener('keydown', onKeyDown)
        modalEl?.remove()
        modalEl = null
    })

    // Re-load section when URL section param changes (handles browser back/forward too)
    $effect(() => {
        const s = section
        if (loading || loadingSection || !meta) return
        if (s && s !== currentSlug) {
            loadSection(s)
        } else if (!s) {
            // null section (guide root breadcrumb) → go to first page
            const firstSlug = meta?.pages?.[0]?.slug ?? meta?.nav?.[0]?.slug
            if (firstSlug && firstSlug !== currentSlug) loadSection(firstSlug)
        }
    })

    // ── Breadcrumbs ────────────────────────────────────────────────────────────

    let sectionLabel = $derived.by(() => {
        if (!currentSlug || !meta) return ''
        // Find label in nav/pages
        const pages = meta.pages ?? meta.nav ?? []
        return pages.find((p: any) => p.slug === currentSlug)?.label ?? currentSlug
    })

    let crumbs = $derived([
        { label: 'Home',    href: '/' },
        { label: gameName || appid, href: `/game/${appid}` },
        { label: 'Journal', href: `/journal/${appid}` },
        { label: meta?.title ?? source, href: `/journal/${appid}/guides/${source}` },
        ...(sectionLabel && sectionLabel !== (meta?.title ?? source) ? [{ label: sectionLabel }] : []),
    ])
</script>

{#if loading}
    <div class="gv-loading"><div class="community-loader"></div></div>
{:else if error}
    <p class="page-error">{error}</p>
{:else if meta}
<div class="gv-wrap">

    <!-- ── Header row: 3-col grid so CONTENTS aligns with breadcrumbs+h1 ── -->
    <div class="gv-header-row">
        <div class="gv-header-gutter"></div>
        <div class="gv-header-main">
            <Breadcrumb {crumbs} />
            <h1 class="gv-page-title">{sectionLabel || meta.title}</h1>
        </div>
        <div class="gv-header-toc">
            <span class="gv-sidebar-label">Contents</span>
        </div>
    </div>

    <!-- ── Full-width separator ──────────────────────────────────────────── -->
    <div class="gv-rule"></div>

    <!-- ── Three-column body ─────────────────────────────────────────────── -->
    <div class="gv-body">

        <!-- Left gutter: page scroll arrows (fixed) -->
        <div class="gv-gutter">
            <button class="gv-nav-arrow" onclick={() => scrollPage(-1)} title="Scroll up" aria-label="Scroll up">↑</button>
            <button class="gv-nav-arrow" onclick={() => scrollPage(1)}  title="Scroll down" aria-label="Scroll down">↓</button>
        </div>

        <!-- Center: content -->
        <div class="gv-content" bind:this={contentEl}>
            {#if loadingSection}
                <div class="gv-section-loading"><div class="community-loader"></div></div>
            {:else}
                <GuideBlockRenderer
                    {blocks}
                    steamId={appid}
                    {source}
                    section={currentSlug ?? ''}
                    onImageClick={openImageModal}
                />
            {/if}
        </div>

        <!-- Right sidebar: TOC nav tree (sticky, no label — it's in the header row) -->
        <aside class="gv-sidebar">
            <div class="gv-sidebar-inner">
                {#if meta.navTree?.length}
                    <nav class="gv-toc">
                        {#each meta.navTree as item}
                            {#if item.type === 'label'}
                                <span class="gv-toc-label">{item.label}</span>
                            {:else if item.type === 'link'}
                                <button
                                    class="gv-toc-link"
                                    class:gv-toc-link--active={isActive(item.slug)}
                                    onclick={() => navTo(item.slug)}
                                >{item.label}</button>
                            {:else if item.type === 'group'}
                                <div class="gv-toc-group">
                                    <button
                                        class="gv-toc-group-hd"
                                        onclick={() => toggleGroup(item.label)}
                                    >
                                        <span class="gv-toc-chevron">{openGroups.has(item.label) ? '▾' : '▸'}</span>
                                        {item.label}
                                    </button>
                                    {#if openGroups.has(item.label)}
                                        <div class="gv-toc-group-body">
                                            {#each item.children as child}
                                                <button
                                                    class="gv-toc-link gv-toc-link--child"
                                                    class:gv-toc-link--active={isActive(child.slug)}
                                                    onclick={() => navTo(child.slug)}
                                                >{child.label}</button>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        {/each}
                    </nav>
                {:else}
                    <nav class="gv-toc">
                        {#each (meta.pages ?? meta.nav ?? []) as item}
                            <button
                                class="gv-toc-link"
                                class:gv-toc-link--active={isActive(item.slug)}
                                onclick={() => navTo(item.slug)}
                            >{item.label}</button>
                        {/each}
                    </nav>
                {/if}
                {#if meta.author}
                    <p class="gv-sidebar-author">by {meta.author}</p>
                {/if}
            </div>
        </aside>
    </div>
</div>
{/if}
