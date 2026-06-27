<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte'
    import { goto } from '$app/navigation'
    import { OverlayScrollbars } from 'overlayscrollbars'
    import Breadcrumb from '../../Breadcrumb.svelte'
    import GuideBlockRenderer from './GuideBlockRenderer.svelte'
    import GuideLanding from './GuideLanding.svelte'

    let { appid, source, guideId, section }: {
        appid: string
        source: string
        guideId: string
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

    let contentEl  = $state<HTMLElement | null>(null)
    let contentOs: ReturnType<typeof OverlayScrollbars> | undefined

    function scrollViewport(): HTMLElement | null {
        return contentOs?.elements().viewport as HTMLElement ?? contentEl
    }

    function scrollPage(delta: 1 | -1) {
        const el = scrollViewport()
        if (!el) return
        el.scrollBy({ top: delta * el.clientHeight * 0.85, behavior: 'smooth' })
    }

    // ── Anchor / fragment link helpers ─────────────────────────────────────────

    function scrollToAnchor(anchor: string) {
        const vp = scrollViewport()
        if (!vp) return
        const el = document.getElementById(anchor)
        if (!el) return
        const elTop = el.getBoundingClientRect().top - vp.getBoundingClientRect().top
        vp.scrollBy({ top: elTop - 16, behavior: 'smooth' })
    }

    // Intercept clicks on links inside the rendered guide content.
    // • href="#"             → guide index link → go to landing page
    // • href="#anchor"       → scroll .gv-content to element (no navigation)
    // • href="page#anchor"   → if the base page is already loaded, just scroll;
    //                          otherwise navTo so # is percent-encoded, not treated as URL fragment
    function onContentClick(e: MouseEvent) {
        const a = (e.target as Element)?.closest('a[href]') as HTMLAnchorElement | null
        if (!a) return
        const href = a.getAttribute('href')
        if (!href) return

        // Bare "#" = bare wiki index URL — go to guide landing page
        if (href === '#') {
            e.preventDefault()
            e.stopPropagation()
            navToLanding()
            return
        }

        const hashIdx = href.indexOf('#')
        if (hashIdx === -1) return
        e.preventDefault()
        e.stopPropagation()
        const anchor = href.slice(hashIdx + 1)
        if (hashIdx === 0) {
            scrollToAnchor(anchor)
        } else {
            const basePage = href.slice(0, hashIdx)
            const currentBase = currentSlug?.split('#')[0] ?? ''
            if (currentBase === basePage) {
                scrollToAnchor(anchor)
            } else {
                navTo(href)
            }
        }
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

    // Open the TOC group that contains `slug` without closing others the user may have opened.
    function autoOpenGroupFor(slug: string) {
        const tree = filteredNavTree
        if (!tree) return
        const toOpen = (tree as any[])
            .filter(item => item.type === 'group' &&
                (item.slug === slug || item.children?.some((c: any) => c.slug === slug)))
            .map(item => item.label)
        if (toOpen.length) openGroups = new Set([...openGroups, ...toOpen])
    }

    // ── Navigation ─────────────────────────────────────────────────────────────

    function navTo(slug: string) {
        goto(`/journal/${appid}/guides/${source}/${guideId}/${encodeURIComponent(slug)}`)
    }

    function navToLanding() {
        goto(`/journal/${appid}/guides/${source}/${guideId}`, { replaceState: false })
    }

    function isActive(slug: string): boolean {
        return slug === currentSlug
    }

    // ── Data loading ───────────────────────────────────────────────────────────

    async function loadMeta() {
        const [metaRes, gameRes] = await Promise.allSettled([
            fetch(`/relay/api/guides/${appid}/${source}/${guideId}/meta`).then(r => r.ok ? r.json() : null),
            fetch(`/relay/api/games/${appid}`).then(r => r.ok ? r.json() : null),
        ])
        meta     = (metaRes as PromiseFulfilledResult<any>).value
        gameName = (gameRes as PromiseFulfilledResult<any>).value?.name ?? ''
        if (!meta) throw new Error('Guide not found')
    }

    async function loadSection(slug: string) {
        loadingSection = true
        const anchorIdx = slug.indexOf('#')
        const anchor = anchorIdx !== -1 ? slug.slice(anchorIdx + 1) : null
        try {
            let data = await fetch(`/relay/api/guides/${appid}/${source}/${guideId}/${encodeURIComponent(slug)}`).then(r => r.ok ? r.json() : null)
            // If the anchor-slug has no pre-sliced page, fall back to the base page
            // and scroll to the anchor within it after render.
            if (!data && anchor) {
                const baseSlug = slug.slice(0, anchorIdx)
                data = await fetch(`/relay/api/guides/${appid}/${source}/${guideId}/${encodeURIComponent(baseSlug)}`).then(r => r.ok ? r.json() : null)
            }
            blocks = data ?? []
            currentSlug = slug
            autoOpenGroupFor(slug)
        } finally {
            loadingSection = false
        }
        await tick()
        if (anchor) {
            scrollToAnchor(anchor)
        } else {
            scrollViewport()?.scrollTo({ top: 0 })
        }
    }

    // ── Table drag-to-scroll ───────────────────────────────────────────────────

    function attachDragScroll(el: HTMLElement): () => void {
        let startX = 0
        let startScroll = 0
        let active = false
        let dragged = false

        function onMouseDown(e: MouseEvent) {
            if (e.button !== 0) return
            startX = e.clientX
            startScroll = el.scrollLeft
            active = true
            dragged = false
            document.body.style.cursor = 'grabbing'
            document.body.style.userSelect = 'none'
        }

        function onMouseMove(e: MouseEvent) {
            if (!active) return
            const delta = startX - e.clientX
            if (Math.abs(delta) > 4) {
                dragged = true
                el.scrollLeft = startScroll + delta
            }
        }

        function onMouseUp() {
            if (!active) return
            active = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }

        // Capture-phase click handler: cancel the click when the mouse moved
        function onClick(e: MouseEvent) {
            if (dragged) {
                e.preventDefault()
                e.stopPropagation()
                dragged = false
            }
        }

        el.addEventListener('mousedown', onMouseDown)
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
        el.addEventListener('click', onClick, true)

        return () => {
            el.removeEventListener('mousedown', onMouseDown)
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            el.removeEventListener('click', onClick, true)
        }
    }

    // Attach drag-scroll to every table container after blocks render
    $effect(() => {
        void blocks // re-run when blocks change
        if (!contentEl) return
        let cancelled = false
        const cleanups: (() => void)[] = []
        tick().then(() => {
            if (cancelled) return
            contentEl!.querySelectorAll<HTMLElement>('.gv-table-wrap, .gv-p > table').forEach(el => {
                cleanups.push(attachDragScroll(el))
            })
        })
        return () => { cancelled = true; cleanups.forEach(fn => fn()) }
    })

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    $effect(() => {
        if (!contentEl) { contentOs?.destroy(); contentOs = undefined; return }
        contentOs = OverlayScrollbars(contentEl, {
            scrollbars: { theme: 'gj-theme', visibility: 'visible', autoHide: 'never', clickScroll: true },
        }) ?? undefined
        return () => { contentOs?.destroy(); contentOs = undefined }
    })

    onMount(async () => {
        try {
            await loadMeta()
            // No section = show landing page; don't auto-navigate to first page.
            if (section) {
                await loadSection(section)
            }
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
            // If only the anchor differs and the element is already rendered, just scroll
            const anchor = s.includes('#') ? s.split('#')[1] : null
            const sBase  = s.split('#')[0]
            const curBase = currentSlug?.split('#')[0] ?? ''
            if (anchor && sBase === curBase && document.getElementById(anchor)) {
                currentSlug = s
                autoOpenGroupFor(sBase)
                scrollToAnchor(anchor)
                return
            }
            loadSection(s)
        } else if (!s && currentSlug) {
            // Navigated back to guide root (landing page) — clear current section
            currentSlug = null
            blocks = []
        }
    })

    // ── Filtered nav tree ─────────────────────────────────────────────────────
    // Only show nav items whose slugs actually exist as parsed pages.
    // Drops groups that become empty after filtering.

    let filteredNavTree = $derived.by(() => {
        if (!meta?.navTree) return null
        const pageSet = new Set<string>((meta.pages ?? []).map((p: any) => p.slug))

        function validSlug(slug: string | undefined): boolean {
            if (!slug) return false
            const base = slug.split('#')[0]
            return pageSet.has(slug) || pageSet.has(base)
        }

        function filterItems(items: any[]): any[] {
            return items.flatMap((item: any) => {
                if (item.type === 'label') return [item]
                if (item.type === 'link') {
                    return validSlug(item.slug) ? [item] : []
                }
                if (item.type === 'group') {
                    const children = filterItems(item.children ?? [])
                    const selfValid = validSlug(item.slug)
                    if (selfValid || children.length > 0) return [{ ...item, children }]
                    return []
                }
                return []
            })
        }

        return filterItems(meta.navTree)
    })

    // ── Breadcrumbs ────────────────────────────────────────────────────────────

    let sectionLabel = $derived.by(() => {
        if (!currentSlug || !meta) return ''
        const pages = meta.pages ?? meta.nav ?? []
        return pages.find((p: any) => p.slug === currentSlug)?.label ?? currentSlug
    })

    let guideLandingHref = $derived(`/journal/${appid}/guides/${source}/${guideId}`)

    let crumbs = $derived([
        { label: 'Home',    href: '/' },
        { label: gameName || appid, href: `/game/${appid}` },
        { label: 'Journal', href: `/journal/${appid}` },
        { label: 'Guides',  href: `/journal/${appid}/guides` },
        { label: meta?.title ?? source, href: currentSlug ? guideLandingHref : undefined },
        ...(sectionLabel ? [{ label: sectionLabel }] : []),
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

        <!-- Left gutter: page scroll arrows (hidden on landing) -->
        <div class="gv-gutter">
            {#if currentSlug}
                <button class="gv-nav-arrow" onclick={() => scrollPage(-1)} title="Scroll up" aria-label="Scroll up">↑</button>
                <button class="gv-nav-arrow" onclick={() => scrollPage(1)}  title="Scroll down" aria-label="Scroll down">↓</button>
            {/if}
        </div>

        <!-- Center: content -->
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="gv-content" bind:this={contentEl} onclick={onContentClick}>
            {#if loadingSection}
                <div class="gv-section-loading"><div class="community-loader"></div></div>
            {:else if !currentSlug}
                <div class="gv-content-inner">
                    <GuideLanding
                        steamId={appid}
                        {source}
                        {guideId}
                        title={meta.title}
                        pageCount={(meta.pages ?? []).length}
                        parsedAt={meta.parsedAt ?? null}
                        sizeBytes={meta.sizeBytes}
                        sourceUrl={meta.sourceUrl ?? null}
                        coverImages={meta.coverImages ?? []}
                        onStart={() => {
                            const firstSlug = meta?.pages?.[0]?.slug ?? meta?.nav?.[0]?.slug
                            if (firstSlug) navTo(firstSlug)
                        }}
                        onNav={(slug: string) => navTo(slug)}
                    />
                </div>
            {:else}
                <div class="gv-content-inner">
                    <GuideBlockRenderer
                        {blocks}
                        steamId={appid}
                        {source}
                        {guideId}
                        section={currentSlug ?? ''}
                        onImageClick={openImageModal}
                    />
                </div>
            {/if}
        </div>

        <!-- Right sidebar: TOC nav tree (sticky, no label — it's in the header row) -->
        <aside class="gv-sidebar">
            <div class="gv-sidebar-inner">
                {#if filteredNavTree?.length}
                    <nav class="gv-toc">
                        {#each filteredNavTree as item}
                            {#if item.type === 'label'}
                                <span class="gv-toc-label">{item.label}</span>
                            {:else if item.type === 'link'}
                                <button
                                    class="gv-toc-link"
                                    class:gv-toc-link--active={isActive(item.slug)}
                                    onclick={() => navTo(item.slug)}
                                >{item.label}</button>
                            {:else if item.type === 'group'}
                                {@const groupOpen = openGroups.has(item.label)}
                                <div class="gv-toc-group">
                                    <div class="gv-toc-group-hd" role="button" tabindex="-1" onclick={() => toggleGroup(item.label)}>
                                        {#if item.slug}
                                            <button
                                                class="gv-toc-link gv-toc-group-nav"
                                                class:gv-toc-link--active={isActive(item.slug)}
                                                onclick={() => navTo(item.slug)}
                                            >{item.label}</button>
                                        {:else}
                                            <span class="gv-toc-group-lbl">{item.label}</span>
                                        {/if}
                                        <button
                                            class="gv-toc-chevron-btn"
                                            onclick={(e) => { e.stopPropagation(); toggleGroup(item.label); }}
                                            aria-label="Toggle section"
                                        >{groupOpen ? '▾' : '▸'}</button>
                                    </div>
                                    {#if groupOpen}
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
