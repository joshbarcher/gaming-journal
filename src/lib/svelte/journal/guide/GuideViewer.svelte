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

    let gameName       = $state('')
    let meta           = $state<any>(null)
    let blocks         = $state<any[]>([])
    let currentSlug    = $state<string | null>(null)
    let loading        = $state(true)
    let loadingSection = $state(false)
    let error          = $state<string | null>(null)

    // ── Page scroll ────────────────────────────────────────────────────────────

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
    function onContentClick(e: MouseEvent) {
        const a = (e.target as Element)?.closest('a[href]') as HTMLAnchorElement | null
        if (!a) return
        const href = a.getAttribute('href')
        if (!href) return

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
        if (e.key === 'Escape') {
            if (ctxMenu) { ctxMenu = null; return }
            if (modalEl?.classList.contains('gv-img-modal--open')) { closeImageModal(); return }
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

    function navTo(slug: string, blockPath?: number[]) {
        if (blockPath?.length) {
            const curBase = (currentSlug ?? '').split('#')[0]
            if (slug === curBase) {
                scrollToBlockPath(blockPath)
                return
            }
            pendingPinPath = blockPath
        }
        goto(`/journal/${appid}/guides/${source}/${guideId}/${encodeURIComponent(slug)}`)
    }

    function navToLanding() {
        goto(`/journal/${appid}/guides/${source}/${guideId}`, { replaceState: false })
    }

    function isActive(slug: string): boolean {
        return slug === currentSlug
    }

    // ── Pins ──────────────────────────────────────────────────────────────────

    interface Pin {
        id: string
        slug: string        // base page slug (no #anchor)
        pageLabel: string
        blockPath: number[] // child-index path from .gv-content-inner to the pinned element
        label: string       // text snippet from the pinned element
    }

    interface PinStore {
        parsedAt: string | null
        pins: Pin[]
    }

    const pinsKey = `guide-pins:${appid}:${source}:${guideId}`

    let pins        = $state<Pin[]>([])
    let pinsOpen    = $state(true)
    let staleNotice = $state(false)

    let ctxMenu = $state<{ x: number; y: number; blockPath: number[]; label: string } | null>(null)
    let pendingPinPath = $state<number[] | null>(null)

    function loadPins() {
        try {
            const raw = localStorage.getItem(pinsKey)
            if (!raw) { pins = []; return }
            const stored: PinStore = JSON.parse(raw)
            const currentParsedAt = meta?.parsedAt ?? null
            // If parsedAt changed the guide was re-downloaded — pins are stale
            if (currentParsedAt && stored.parsedAt && stored.parsedAt !== currentParsedAt) {
                pins = []
                localStorage.removeItem(pinsKey)
                staleNotice = true
            } else {
                pins = stored.pins ?? []
            }
        } catch { pins = [] }
    }

    function savePins(updated: Pin[]) {
        try {
            const store: PinStore = { parsedAt: meta?.parsedAt ?? null, pins: updated }
            localStorage.setItem(pinsKey, JSON.stringify(store))
        } catch {}
    }

    function deletePin(id: string) {
        const updated = pins.filter(p => p.id !== id)
        pins = updated
        savePins(updated)
    }

    function navToPin(pin: Pin) {
        ctxMenu = null
        const curBase = (currentSlug ?? '').split('#')[0]
        if (pin.slug === curBase) {
            scrollToBlockPath(pin.blockPath)
        } else {
            pendingPinPath = pin.blockPath
            navTo(pin.slug)
        }
    }

    // ── Block path utilities ───────────────────────────────────────────────────

    function getContentInner(): HTMLElement | null {
        return contentEl?.querySelector('.gv-content-inner') as HTMLElement ?? null
    }

    // Walk up from target to the nearest block-level container:
    // a direct child of .gv-content-inner, or a direct child of any .gv-section div.
    function getBlockPath(target: Element): number[] {
        const inner = getContentInner()
        if (!inner) return []

        let el: Element | null = target
        while (el && el !== inner) {
            const parent = el.parentElement
            if (!parent || parent === inner || parent.classList.contains('gv-section')) break
            el = parent
        }
        if (!el || el === inner) return []

        const path: number[] = []
        let cur: Element | null = el
        while (cur && cur !== inner) {
            const parent = cur.parentElement
            if (!parent) break
            path.unshift(Array.from(parent.children).indexOf(cur))
            cur = parent
        }
        return path
    }

    function resolveBlockPath(path: number[]): HTMLElement | null {
        const inner = getContentInner()
        if (!inner || !path.length) return null
        let el: Element | null = inner
        for (const idx of path) {
            el = el?.children[idx] ?? null
            if (!el) return null
        }
        return el as HTMLElement
    }

    function scrollToBlockPath(path: number[]) {
        const el = resolveBlockPath(path)
        if (!el) return
        const vp = scrollViewport()
        if (!vp) return
        const elTop = el.getBoundingClientRect().top - vp.getBoundingClientRect().top
        vp.scrollBy({ top: elTop - 16, behavior: 'smooth' })
    }

    // On cold load, images above the target haven't expanded yet, making layout
    // positions wrong. Wait for preceding images before computing scroll offset.
    async function scrollToBlockPathWhenReady(path: number[]) {
        const el = resolveBlockPath(path)
        const inner = getContentInner()
        if (!el || !inner) return

        const pending = (Array.from(inner.querySelectorAll('img')) as HTMLImageElement[])
            .filter(img => !img.complete &&
                !!(el.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING))

        if (pending.length) {
            await Promise.all(pending.map(img => new Promise<void>(resolve => {
                img.addEventListener('load', () => resolve(), { once: true })
                img.addEventListener('error', () => resolve(), { once: true })
                setTimeout(resolve, 2000)
            })))
        }

        scrollToBlockPath(path)
    }

    function applyPinHighlights() {
        const inner = getContentInner()
        if (!inner) return
        // Clear existing markers and highlights
        inner.querySelectorAll('.gv-pinned').forEach(el => {
            el.classList.remove('gv-pinned')
            el.querySelector('.gv-pin-marker')?.remove()
        })
        const baseSlug = (currentSlug ?? '').split('#')[0]
        for (const pin of pins) {
            if (pin.slug !== baseSlug) continue
            const el = resolveBlockPath(pin.blockPath)
            if (!el) continue
            el.classList.add('gv-pinned')
            // Inject a real button so click-to-delete works
            const btn = document.createElement('button')
            btn.className = 'gv-pin-marker'
            btn.setAttribute('aria-label', 'Remove pin')
            btn.title = 'Click to remove pin'
            btn.innerHTML = PIN_SVG
            btn.addEventListener('click', (e) => {
                e.preventDefault()
                e.stopPropagation()
                deletePin(pin.id)
            })
            el.prepend(btn)
        }
    }

    // Re-apply pin highlights whenever blocks or pins change
    $effect(() => {
        void blocks
        void pins
        void currentSlug
        if (!contentEl) return
        tick().then(applyPinHighlights)
    })

    // Lucide "Pin" icon — shared between the DOM-injected marker and the template
    const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>`

    // ── Context menu ───────────────────────────────────────────────────────────

    function extractLabel(target: Element): string {
        const figure = target.closest('figure') as HTMLElement | null
        if (figure || target.tagName === 'IMG') {
            const caption = figure?.querySelector('figcaption')?.textContent?.trim()
            const alt = (figure?.querySelector('img') as HTMLImageElement | null)?.alt?.trim()
            return caption || alt || 'Image'
        }
        const tr = target.closest('tr') as HTMLElement | null
        if (tr) {
            const text = Array.from(tr.querySelectorAll('td, th'))
                .map(c => c.textContent?.trim()).filter(Boolean).slice(0, 3).join(' · ')
            return text.length > 70 ? text.slice(0, 70) + '…' : text
        }
        const readable = target.closest('p, li, h2, h3, h4, figcaption') as HTMLElement | null
        const raw = readable?.textContent?.trim() ?? ''
        return raw.length > 70 ? raw.slice(0, 70) + '…' : raw || 'Pin'
    }

    let currentPageHasPin = $derived(
        pins.some(p => p.slug === (currentSlug ?? '').split('#')[0])
    )

    function onContextMenu(e: MouseEvent) {
        if (!currentSlug) return
        // Don't intercept right-clicks on the pin marker itself
        if ((e.target as Element).closest('.gv-pin-marker')) return
        // Let native context menu handle links (e.g. open in new tab)
        if ((e.target as Element).closest('a')) return
        e.preventDefault()
        const target = e.target as Element
        const blockPath = getBlockPath(target)
        if (!blockPath.length) return
        const label = extractLabel(target)
        const x = Math.min(e.clientX, window.innerWidth - 190)
        const y = Math.min(e.clientY, window.innerHeight - 60)
        ctxMenu = { x, y, blockPath, label }
    }

    function doCreatePin() {
        if (!ctxMenu || !currentSlug) return
        const baseSlug = currentSlug.split('#')[0]
        const existing = pins.find(p => p.slug === baseSlug)
        const pin: Pin = {
            id: existing?.id ?? crypto.randomUUID(),
            slug: baseSlug,
            pageLabel: sectionLabel || baseSlug,
            blockPath: ctxMenu.blockPath,
            label: ctxMenu.label,
        }
        // One pin per page — replace if one already exists
        const updated = existing
            ? pins.map(p => p.slug === baseSlug ? pin : p)
            : [...pins, pin]
        pins = updated
        savePins(updated)
        ctxMenu = null
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
        if (pendingPinPath) {
            const path = pendingPinPath
            pendingPinPath = null
            scrollToBlockPathWhenReady(path)
        } else if (anchor) {
            scrollToAnchor(anchor)
        } else {
            const pagePin = pins.find(p => p.slug === slug.split('#')[0])
            if (pagePin) {
                scrollToBlockPath(pagePin.blockPath)
            } else {
                scrollViewport()?.scrollTo({ top: 0 })
            }
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

    $effect(() => {
        void blocks
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
            loadPins()
            if (section) {
                await loadSection(section)
            }
        } catch (e) {
            error = (e as Error).message
        } finally {
            loading = false
        }

        // loadSection's scroll ran while loading=true hid the gv-wrap, so contentEl
        // was null and the scroll silently failed. Retry now that the DOM is live.
        if (section && !section.includes('#')) {
            await tick()
            const pagePin = pins.find(p => p.slug === section.split('#')[0])
            if (pagePin) scrollToBlockPathWhenReady(pagePin.blockPath)
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
            currentSlug = null
            blocks = []
        }
    })

    // ── Filtered nav tree ─────────────────────────────────────────────────────

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

    <!-- ── Header row ──────────────────────────────────────────────────── -->
    <div class="gv-header-row">
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

        <!-- Center: content -->
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="gv-content" bind:this={contentEl} onclick={onContentClick} oncontextmenu={onContextMenu}>
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
                        onNav={(slug: string, blockPath?: number[]) => navTo(slug, blockPath)}
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

        <!-- Right sidebar: TOC nav tree -->
        <aside class="gv-sidebar">
            <div class="gv-sidebar-inner">

                <!-- ── Pins ── -->
                {#if staleNotice}
                    <div class="gv-pins-stale">
                        <span>Pins cleared — guide was re-downloaded.</span>
                        <button class="gv-pins-stale-close" onclick={() => staleNotice = false}>×</button>
                    </div>
                {/if}
                {#if pins.length > 0}
                    <div class="gv-pins-section">
                        <button class="gv-pins-hd" onclick={() => pinsOpen = !pinsOpen}>
                            <span class="gv-pins-title">Pins</span>
                            <span class="gv-pins-count">{pins.length}</span>
                            <span class="gv-pins-chevron">{pinsOpen ? '▾' : '▸'}</span>
                        </button>
                        {#if pinsOpen}
                            <div class="gv-pins-list">
                                {#each pins as pin (pin.id)}
                                    <div class="gv-pin-entry">
                                        <button class="gv-pin-nav" onclick={() => navToPin(pin)} title={pin.label}>
                                            <span class="gv-pin-page">{pin.pageLabel}</span>
                                            <span class="gv-pin-label">{pin.label}</span>
                                        </button>
                                        <button class="gv-pin-del" onclick={() => deletePin(pin.id)} aria-label="Remove pin">×</button>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                    <div class="gv-pins-rule"></div>
                {/if}

                <!-- ── TOC nav tree ── -->
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
                                <div class="gv-toc-group" class:gv-toc-group--open={openGroups.has(item.label)}>
                                    <button class="gv-toc-group-hd" onclick={() => toggleGroup(item.label)}>
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

<!-- Context menu — fixed position so it clears scroll containers -->
{#if ctxMenu}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="gv-ctx-overlay" onclick={() => ctxMenu = null}></div>
    <div class="gv-ctx-menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px">
        <button class="gv-ctx-item" onclick={doCreatePin}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>
            {currentPageHasPin ? 'Move pin here' : 'Pin this location'}
        </button>
    </div>
{/if}
{/if}
