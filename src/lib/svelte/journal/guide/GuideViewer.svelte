<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte'
    import { goto } from '$app/navigation'
    import Breadcrumb from '../../Breadcrumb.svelte'
    import GuideBlockRenderer from './GuideBlockRenderer.svelte'
    import GuideLanding from './GuideLanding.svelte'
    import GuideInlineSearch from './GuideInlineSearch.svelte'
    import GuidePageSearch from './GuidePageSearch.svelte'
    import Fuse from 'fuse.js'
    import { getCachedFulltext } from '$lib/guide-cache.js'
    import type { FtEntry } from '$lib/guide-cache.js'
    import { store as sidebarStore } from '$lib/sidebar.svelte.js'

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
    let loading          = $state(true)
    let loadingSection   = $state(false)
    let error            = $state<string | null>(null)
    let guideSearchOpen  = $state(false)

    // Full-text index for guide-wide search — loaded once per guide, survives modal open/close.
    let ftEntries = $state<FtEntry[] | null>(null)
    let ftFuse    = $derived.by(() =>
        ftEntries
            ? new Fuse(ftEntries, {
                keys: ['text'],
                includeMatches: true,
                includeScore: true,
                threshold: 0.3,
                minMatchCharLength: 3,
                ignoreLocation: true,
              })
            : null
    )
    // Lazy: only fetch when the user first opens the inline search modal.
    $effect(() => {
        if (!guideSearchOpen || !meta || ftEntries !== null) return
        getCachedFulltext(appid, source, guideId, meta.parsedAt ?? null)
            .then(entries => { ftEntries = entries })
    })

    // ── Page scroll ────────────────────────────────────────────────────────────

    let contentEl  = $state<HTMLElement | null>(null)
    let scrollProgress = $state(0)

    function scrollViewport(): HTMLElement | null {
        return contentEl
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

        // Links out to the live source (gv-link-external) — let the browser open them.
        // Checked before the fragment logic below, which would otherwise treat the
        // "#Section" in a URL like https://…/wiki/Title#Section as an in-page anchor.
        if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(href)) return

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
        if (e.shiftKey && e.code === 'Space') {
            const tag = (e.target as HTMLElement).tagName
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !(e.target as HTMLElement).isContentEditable) {
                e.preventDefault()
                if (!e.repeat) guideSearchOpen = !guideSearchOpen
                return
            }
        }
        // Let the inline search modal handle all remaining keys while it's open
        if (guideSearchOpen) return
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

    // Groups nest, so labels alone can collide across branches — key by slug when present.
    function groupKey(item: any): string {
        return item.slug ?? item.label
    }

    function toggleGroup(key: string) {
        const next = new Set(openGroups)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        openGroups = next
    }

    // Open every group on the path to `slug`, at any depth.
    function autoOpenGroupFor(slug: string) {
        const tree = filteredNavTree
        if (!tree) return

        function pathTo(items: any[]): string[] | null {
            for (const item of items) {
                if (item.type === 'group') {
                    // Viewing a group's own page opens that group too.
                    if (item.slug === slug) return [groupKey(item)]
                    const below = pathTo(item.children ?? [])
                    if (below) return [groupKey(item), ...below]
                } else if (item.slug === slug) {
                    return []
                }
            }
            return null
        }

        const toOpen = pathTo(tree as any[])
        if (toOpen?.length) openGroups = new Set([...openGroups, ...toOpen])
    }

    // ── Navigation ─────────────────────────────────────────────────────────────

    // Canonical URL for a guide section. Used both for programmatic navigation and
    // as the `href` on TOC links so they support native "Open in new tab".
    function sectionHref(slug: string): string {
        return `/journal/${appid}/guides/${source}/${guideId}/${encodeURIComponent(slug)}`
    }

    function navTo(slug: string, blockPath?: number[]) {
        if (isMobile()) tocCollapsed = true
        if (blockPath?.length) {
            const curBase = (currentSlug ?? '').split('#')[0]
            if (slug === curBase) {
                scrollToBlockPath(blockPath)
                return
            }
            pendingPinPath = blockPath
        }
        goto(sectionHref(slug))
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

    let pins          = $state<Pin[]>([])
    let pinsOpen      = $state(true)
    let staleNotice   = $state(false)
    let brokenPinIds  = $state<Set<string>>(new Set())

    let ctxMenu = $state<{ x: number; y: number; blockPath: number[]; label: string } | null>(null)
    let pendingPinPath = $state<number[] | null>(null)

    const pinsApiUrl = `/relay/api/guides/${appid}/${source}/${encodeURIComponent(guideId)}/pins`

    // Legacy per-browser pins from before pins moved server-side. Read once so they can be
    // migrated up to the server, then cleared.
    function readLegacyLocalPins(): PinStore {
        try {
            const raw = localStorage.getItem(pinsKey)
            if (!raw) return { parsedAt: null, pins: [] }
            const s = JSON.parse(raw)
            return { parsedAt: s.parsedAt ?? null, pins: Array.isArray(s.pins) ? s.pins : [] }
        } catch { return { parsedAt: null, pins: [] } }
    }

    async function loadPins() {
        let server: PinStore = { parsedAt: null, pins: [] }
        try {
            const res = await fetch(pinsApiUrl)
            if (res.ok) server = await res.json()
        } catch { /* offline — fall through to empty/legacy */ }

        let list        = Array.isArray(server.pins) ? server.pins : []
        let listParsedAt = server.parsedAt ?? null

        // One-time migration: if the server has none yet, adopt any legacy localStorage pins.
        if (list.length === 0) {
            const legacy = readLegacyLocalPins()
            if (legacy.pins.length) {
                list = legacy.pins
                listParsedAt = legacy.parsedAt
                savePins(list)
            }
            try { localStorage.removeItem(pinsKey) } catch {}
        }

        // If the guide was re-downloaded since these pins were saved, their blockPaths may no
        // longer line up — clear them and flag the notice (semantics unchanged).
        const currentParsedAt = meta?.parsedAt ?? null
        if (currentParsedAt && listParsedAt && listParsedAt !== currentParsedAt) {
            pins = []
            savePins([])
            staleNotice = true
        } else {
            pins = list
        }
    }

    function savePins(updated: Pin[]) {
        fetch(pinsApiUrl, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ parsedAt: meta?.parsedAt ?? null, pins: updated }),
        }).catch(() => {})
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
        const newBroken = new Set<string>()
        for (const pin of pins) {
            if (pin.slug !== baseSlug) continue
            const el = resolveBlockPath(pin.blockPath)
            if (!el) { newBroken.add(pin.id); continue }
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
        brokenPinIds = newBroken
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

    // ── TOC collapse ───────────────────────────────────────────────────────────
    // Below 1280px the sidebar becomes an overlay drawer (see guide-viewer.css)
    // rather than a permanent grid column, so "collapsed" there means "closed".
    // Ignore the desktop-persisted preference and always start closed on mobile,
    // and auto-close after navigating so the drawer doesn't obscure the new page.

    function isMobile() {
        return typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches
    }

    let tocCollapsed = $state(false)

    // The main app hamburger nav is a second full-screen overlay on mobile — if both
    // ended up open at once, the app nav visually wins regardless of z-index (it sits
    // in a different stacking context), which looked broken. Close our drawer instead.
    $effect(() => {
        if (sidebarStore.appSidebarOpen) tocCollapsed = true
    })

    function toggleToc() {
        tocCollapsed = !tocCollapsed
        localStorage.setItem('guide-toc-collapsed', String(tocCollapsed))
    }

    interface CollapsedPage {
        label: string
        fullLabel: string
        slug: string
        navigable: boolean
        isGroup: boolean
    }

    // Numbered list for collapsed TOC — top-level only (no sub-pages).
    // Groups are numbered but children are omitted; clicking a non-navigable group expands the TOC.
    let collapsedPages = $derived.by<CollapsedPage[]>(() => {
        const result: CollapsedPage[] = []
        const tree = filteredNavTree
        if (tree?.length) {
            let n = 0
            for (const item of tree) {
                if (item.type === 'label') continue
                n++
                if (item.type === 'link') {
                    result.push({ label: String(n), fullLabel: item.label, slug: item.slug, navigable: true, isGroup: false })
                } else if (item.type === 'group') {
                    result.push({ label: String(n), fullLabel: item.label, slug: item.slug ?? '', navigable: !!item.slug, isGroup: true })
                }
            }
        } else if (meta) {
            const pages = meta.pages ?? meta.nav ?? []
            pages.forEach((p: any, i: number) => {
                result.push({ label: String(i + 1), fullLabel: p.label, slug: p.slug, navigable: true, isGroup: false })
            })
        }
        return result
    })

    let tocTooltip = $state<{ text: string; x: number; y: number } | null>(null)

    function showTocTooltip(e: MouseEvent, text: string) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        tocTooltip = { text, x: rect.left - 6, y: rect.top + rect.height / 2 }
    }

    function hideTocTooltip() {
        tocTooltip = null
    }

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
        const el = contentEl
        if (!el) { scrollProgress = 0; return }
        function update() {
            const max = el.scrollHeight - el.clientHeight
            scrollProgress = max > 0 ? (el.scrollTop / max) * 100 : 0
        }
        el.addEventListener('scroll', update, { passive: true })
        update()
        return () => el.removeEventListener('scroll', update)
    })

    onMount(async () => {
        tocCollapsed = isMobile() ? true : localStorage.getItem('guide-toc-collapsed') === 'true'
        try {
            await loadMeta()
            fetch(`/relay/api/guides/${appid}/${source}/${guideId}/mark-used`, { method: 'POST' }).catch(() => {})
            await loadPins()
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
            // TOC links are real anchors, so plain clicks route through SvelteKit
            // rather than navTo() — collapse the mobile drawer here so it closes for
            // every navigation source (TOC anchors, breadcrumbs, back/forward).
            if (isMobile()) tocCollapsed = true
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
        // navTree has labels from the manifest fetch; meta.pages labels may be
        // raw slugs for sources with numeric IDs (e.g. Game8 archive IDs).
        const tree = meta.navTree as any[] | null
        if (tree) {
            const find = (items: any[]): string | null => {
                for (const item of items) {
                    if (item.slug === currentSlug) return item.label as string
                    const below = item.children ? find(item.children as any[]) : null
                    if (below) return below
                }
                return null
            }
            const label = find(tree)
            if (label) return label
        }
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

<svelte:head><title>{sectionLabel || meta?.title || gameName || 'Guide'}</title></svelte:head>

{#if loading}
    <div class="gv-loading"><div class="community-loader"></div></div>
{:else if error}
    <p class="page-error">{error}</p>
{:else if meta}
<div class="gv-wrap" class:gv-toc--collapsed={tocCollapsed}>

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

        <!-- Reading progress bar — absolute, spans content column only -->
        {#if currentSlug}
            <div class="gv-scroll-progress" aria-hidden="true">
                <div class="gv-scroll-progress-fill" style="width:{scrollProgress}%"></div>
            </div>
        {/if}

        <!-- Center: content -->
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="gv-content" bind:this={contentEl} onclick={onContentClick} oncontextmenu={onContextMenu}>
            {#if loadingSection}
                <div class="gv-section-loading"><div class="community-loader"></div></div>
            {:else if !currentSlug}
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
            {:else}
                <GuidePageSearch
                    {blocks}
                    slug={currentSlug ?? ''}
                    onScroll={scrollToBlockPath}
                />
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

        <button class="gv-toc-gutter-btn" onclick={toggleToc} title={tocCollapsed ? 'Expand contents' : 'Collapse contents'}>
            {#if tocCollapsed}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>
                </svg>
            {:else}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>
                </svg>
            {/if}
        </button>

        <!-- Drawer scrim — only rendered/visible below 1280px, where the TOC is an overlay -->
        {#if !tocCollapsed}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="gv-toc-scrim" onclick={toggleToc}></div>
        {/if}

        <!-- TOC wrap: constrains sidebar scroll height -->
        <div class="gv-toc-wrap">
            <aside class="gv-sidebar">
            {#if tocCollapsed}
                <!-- ── Collapsed view: pins then numbered pages ── -->
                <div class="gv-toc-collapsed">
                    {#each pins as pin (pin.id)}
                        <button
                            class="gv-tcc-pin"
                            onclick={() => navToPin(pin)}
                            onmouseenter={(e) => showTocTooltip(e, `${pin.pageLabel} — ${pin.label}`)}
                            onmouseleave={hideTocTooltip}
                        >
                            {@html PIN_SVG}
                        </button>
                    {/each}
                    {#if pins.length > 0}
                        <div class="gv-tcc-rule"></div>
                    {/if}
                    {#each collapsedPages as item (item.slug + item.label)}
                        {#if item.navigable}
                            <a
                                class="gv-tcc-badge"
                                class:gv-tcc-badge--active={isActive(item.slug)}
                                class:gv-tcc-badge--group={item.isGroup}
                                href={sectionHref(item.slug)}
                                onmouseenter={(e) => showTocTooltip(e, item.fullLabel)}
                                onmouseleave={hideTocTooltip}
                            >{item.label}</a>
                        {:else}
                            <button
                                class="gv-tcc-badge gv-tcc-badge--group gv-tcc-badge--no-nav"
                                onclick={() => tocCollapsed = false}
                                onmouseenter={(e) => showTocTooltip(e, item.fullLabel)}
                                onmouseleave={hideTocTooltip}
                            >{item.label}</button>
                        {/if}
                    {/each}
                </div>
            {:else}
                <!-- ── Expanded view ── -->
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
                                            <div class="gv-pin-entry" class:gv-pin-entry--broken={brokenPinIds.has(pin.id)}>
                                                <button class="gv-pin-nav" onclick={() => navToPin(pin)} title={brokenPinIds.has(pin.id) ? 'Location not found — delete and re-pin to restore' : pin.label}>
                                                    <span class="gv-pin-page">{pin.pageLabel}</span>
                                                    <span class="gv-pin-label">{#if brokenPinIds.has(pin.id)}<span class="gv-pin-broken">Location not found</span>{:else}{pin.label}{/if}</span>
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
                        <!-- Recursive: IGN nests groups inside groups (Walkthrough › Calendar › June). -->
                        {#snippet tocItems(items: any[], depth: number)}
                            {#each items as item}
                                {#if item.type === 'label'}
                                    <span class="gv-toc-label">{item.label}</span>
                                {:else if item.type === 'link'}
                                    <a
                                        class="gv-toc-link"
                                        class:gv-toc-link--child={depth > 0}
                                        class:gv-toc-link--active={isActive(item.slug)}
                                        href={sectionHref(item.slug)}
                                    >{item.label}</a>
                                {:else if item.type === 'group'}
                                    {@const key = groupKey(item)}
                                    <div class="gv-toc-group" class:gv-toc-group--open={openGroups.has(key)}>
                                        <button class="gv-toc-group-hd" onclick={() => toggleGroup(key)}>
                                            {item.label}
                                        </button>
                                        {#if openGroups.has(key)}
                                            <div class="gv-toc-group-body">
                                                {@render tocItems(item.children ?? [], depth + 1)}
                                            </div>
                                        {/if}
                                    </div>
                                {/if}
                            {/each}
                        {/snippet}

                        {#if filteredNavTree?.length}
                            <nav class="gv-toc">
                                {@render tocItems(filteredNavTree, 0)}
                            </nav>
                        {:else}
                            <nav class="gv-toc">
                                {#each (meta.pages ?? meta.nav ?? []) as item}
                                    <a
                                        class="gv-toc-link"
                                        class:gv-toc-link--active={isActive(item.slug)}
                                        href={sectionHref(item.slug)}
                                    >{item.label}</a>
                                {/each}
                            </nav>
                        {/if}
                    {#if meta.author}
                        <p class="gv-sidebar-author">by {meta.author}</p>
                    {/if}
                </div>
            {/if}
            </aside>
        </div>
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
{#if tocTooltip}
    <div class="gv-tcc-tooltip" style="left:{tocTooltip.x}px;top:{tocTooltip.y}px">
        {tocTooltip.text}
    </div>
{/if}
{/if}

{#if guideSearchOpen}
    <GuideInlineSearch
        fuse={ftFuse}
        onclose={() => guideSearchOpen = false}
        onNav={navTo}
    />
{/if}
