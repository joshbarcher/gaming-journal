import Fuse from 'fuse.js'
import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'

import { getGameDetail } from '@/api/gamePage'
import { getGuideMeta, getGuideSectionBlocks, guideImageUrl } from '@/api/guides'
import { ContentBlockRenderer, type ContentBlock, type ListItem } from '@/components/shared/ContentBlockRenderer'
import { GuideTocPanel } from '@/components/shared/GuideTocHost'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { openScreenshotLightbox } from '@/store/screenshotLightboxStore'
import { useGuidePinsStore } from '@/store/guidePinsStore'
import { useGuideTocStore } from '@/store/guideTocStore'
import { useSidebarStore } from '@/store/sidebarStore'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { NavItem } from 'gaming-journal-contracts/guideMeta'

type Crumb = { label: string; onPress?: () => void }

// Width of the always-visible Contents column at the tablet/desktop tier (web `.gv-sidebar` ≈ 300px).
const TOC_PANEL_WIDTH = 300
// web `.gv-content-inner` horizontal gutter: 44px desktop / 20px mobile (<1280px).
const GUTTER_WIDE = 44
const GUTTER_NARROW = 20

// Guide pins are stored in the WEB DOM coordinate: a `.gv-section` renders its heading as child[0],
// so a section's content children are offset +1. Native's block tree has no separate heading node —
// a section's children start at index 0. Translate a stored (web) pin path → native index path when
// consuming a pin (highlight + scroll), and native → web when creating one, so pins line up across
// web ↔ native. (Search/anchor paths are already native — only pins cross this boundary.)
function webPinToNative(webPath: number[], blocks: ContentBlock[]): number[] | null {
    const out: number[] = []
    let curBlocks: ContentBlock[] = blocks
    let parentIsSection = false
    for (let d = 0; d < webPath.length; d++) {
        let idx = webPath[d]
        if (parentIsSection) {
            if (idx === 0) return out           // the section's own heading → target the section itself
            idx -= 1
        }
        const block = curBlocks[idx]
        if (!block) return out.length ? out : null
        out.push(idx)
        parentIsSection = block.type === 'section'
        curBlocks = (block.type === 'section' ? block.children : undefined) ?? []
    }
    return out
}
function nativePinToWeb(nativePath: number[], blocks: ContentBlock[]): number[] {
    const out: number[] = []
    let curBlocks: ContentBlock[] = blocks
    let parentIsSection = false
    for (let d = 0; d < nativePath.length; d++) {
        const idx = nativePath[d]
        out.push(parentIsSection ? idx + 1 : idx)
        const block = curBlocks[idx]
        parentIsSection = block?.type === 'section'
        curBlocks = (block?.type === 'section' ? block.children : undefined) ?? []
    }
    return out
}

// Port of GuideViewer.svelte — content rendering, in-app link routing, image lightbox (its own
// earlier item), extended here with Guide Pins (long-press to place, redesigned block-index
// addressing — see storage/guidePins.ts's own note on why this is a real improvement over the
// web's DOM-walk, not just a port).
//
// **Real, confirmed environment difference, not a port**: the web's link-interception exists
// specifically because SvelteKit intercepts `<a href>` clicks at the capture phase, before any
// bubble-phase handler on a child `<a>` can fire (see memory: feedback_sveltekit_link_interception —
// the reason `onContentClick` lives on the *container* div, not on individual anchors). That whole
// problem doesn't exist here: react-native-render-html's own `renderersProps.a.onPress` fires per
// link directly (already wired in ContentBlockRenderer from its first item) — no capture-vs-bubble
// workaround needed, RN has no anchor-click event model to fight in the first place.
//
// **Deliberately NOT ported from GuideViewer.svelte**: table drag-to-scroll (a desktop mouse-drag
// affordance — RN's ScrollView/horizontal tables already support native touch-scroll, so this is a
// simplification, not a missing feature, exactly like Backlog's dropped CSS pulse animation),
// keyboard shortcuts (no keyboard on touch), the reading-progress bar (small, cosmetic, deferred).
export default function GuideSectionScreen() {
    const { appid: appidStr, source, guideId, slug: rawSlug, anchor } = useLocalSearchParams<{
        appid: string; source: string; guideId: string; slug: string; anchor?: string
    }>()
    const appid = Number(appidStr)
    const slug = decodeURIComponent(rawSlug)
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data

    const breakpoint = useBreakpoint()
    const isWide = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'

    // Tier-aware reading gutter + a deterministic content width for ContentBlockRenderer (computed from
    // window − rail − TOC column − gutters, NOT measured, so images/tables never overflow the gutters).
    const { width: winW } = useWindowDimensions()
    const collapsed = useSidebarStore(s => s.collapsed)
    const gutter = isWide ? GUTTER_WIDE : GUTTER_NARROW
    const rail = isWide ? (collapsed ? 68 : 280) : 0
    const mainColW = winW - rail - (isWide ? TOC_PANEL_WIDTH : 0)
    const blockContentW = Math.max(1, mainColW - gutter * 2)

    const metaQuery = useQuery({ queryKey: ['guideMeta', appid, source, guideId], queryFn: () => getGuideMeta(appid, source, guideId) })
    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const gameName = gameQuery.data?.name ?? ''
    const blocksQuery = useQuery({
        queryKey: ['guideSection', appid, source, guideId, slug],
        queryFn: () => getGuideSectionBlocks(appid, source, guideId, slug),
    })

    const { pins, staleNotice, loadForGuide, createPin, deletePin, scrollRequest } = useGuidePinsStore()
    const pinFor = useGuidePinsStore(s => s.pinFor)

    const scrollRef = useRef<ScrollView>(null)
    const anchorRefs = useRef<Map<string, View>>(new Map())
    const blockRefs = useRef<Map<string, View>>(new Map())
    // Parent-relative onLayout y per block path — summed over a path's prefixes for a deterministic
    // absolute scroll offset (measureLayout's getInnerViewNode target is unreliable on New Arch).
    const blockOffsets = useRef<Map<string, number>>(new Map())

    // Load this guide's pins once meta (and its real parsedAt, needed for stale detection) is
    // available — mirrors loadPins() being called right after loadMeta() in the web's onMount.
    useEffect(() => {
        if (metaQuery.data) loadForGuide(appid, source, guideId, metaQuery.data.parsedAt ?? null)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when the guide identity or its real parsedAt changes
    }, [appid, source, guideId, metaQuery.data?.parsedAt])

    function scrollToAnchor(id: string) {
        const node = anchorRefs.current.get(id)
        const scrollNode = scrollRef.current
        if (!node || !scrollNode) return
        node.measureLayout(scrollNode.getInnerViewNode?.() ?? scrollNode, (_x: number, y: number) => {
            scrollNode.scrollTo({ y: Math.max(0, y - 16), animated: true })
        })
    }

    // Native block index path → absolute scroll offset by summing the parent-relative onLayout y of
    // every prefix (see blockOffsets). Deterministic; falls back to measureLayout only if a prefix
    // hasn't been measured yet.
    function scrollToBlockPath(path: number[], animated = true) {
        const scrollNode = scrollRef.current
        if (!scrollNode || path.length === 0) return
        let y = 0
        let haveAll = true
        for (let end = 1; end <= path.length; end++) {
            const off = blockOffsets.current.get(JSON.stringify(path.slice(0, end)))
            if (off == null) { haveAll = false; break }
            y += off
        }
        if (haveAll) {
            scrollNode.scrollTo({ y: Math.max(0, y - 16), animated })
            return
        }
        const node = blockRefs.current.get(JSON.stringify(path))
        if (!node) return
        node.measureLayout(
            (scrollNode as unknown as { getInnerViewNode?: () => number }).getInnerViewNode?.() ?? (scrollNode as never),
            (_x: number, my: number) => scrollNode.scrollTo({ y: Math.max(0, my - 16), animated }),
            () => {},
        )
    }

    // In-page search jump: dismiss the keyboard (so the target block isn't hidden behind it) then
    // scroll the section to the matched block. Reuses the same measureLayout/blockRefs path the
    // anchor-jump and pin auto-scroll already use.
    function onSearchJump(path: number[]) {
        // Scroll only once the keyboard has FULLY hidden — its retract relayout was cancelling a
        // scroll fired mid-animation (confirmed: scrollTo ran with the right offset but didn't move).
        // Instant (non-animated) scroll so a lingering layout pass can't interrupt it. Falls back on
        // a timeout when the keyboard was already down (no keyboardDidHide event fires). Path is
        // native — search entries use the native coordinate, unlike pins.
        let done = false
        const run = () => { if (done) return; done = true; scrollToBlockPath(path, false) }
        const sub = Keyboard.addListener('keyboardDidHide', () => { sub.remove(); setTimeout(run, 60) })
        Keyboard.dismiss()
        setTimeout(() => { sub.remove(); run() }, 500)
    }

    // Scroll priority ported from loadSection(): an explicit anchor wins, then this page's own
    // saved pin, then top. (The web's 3rd priority, `pendingPinPath`, is redundant here — cross-page
    // pin navigation just does a normal route push and lets this same effect find the destination
    // page's own pin on mount, rather than threading a separate pending-path signal through.)
    useEffect(() => {
        if (!blocksQuery.data) return
        // 300ms (was 50) so the per-block onLayout offsets have populated before the deterministic
        // scroll runs (they fire after the first render pass, unlike the old measureLayout call).
        const t = setTimeout(() => {
            const pagePin = pinFor(slug)
            if (anchor) scrollToAnchor(anchor)
            else if (pagePin) {
                const np = webPinToNative(pagePin.blockPath, blocksQuery.data!)
                if (np) scrollToBlockPath(np)
            } else scrollRef.current?.scrollTo({ y: 0, animated: false })
        }, 300)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the actual section data identity changes
    }, [blocksQuery.data, anchor])

    // Pub/sub scroll request from the root-mounted TOC drawer — fires when the user taps a pin for
    // the page they're *already* viewing (see guidePinsStore.ts's own note on why this needs a
    // signal rather than a direct ref handle).
    useEffect(() => {
        if (!scrollRequest) return
        const np = webPinToNative(scrollRequest.path, blocksQuery.data ?? [])
        if (np) scrollToBlockPath(np)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per new request, not on every render
    }, [scrollRequest?.nonce])

    function onLinkPress(href: string) {
        if (href === '#') {
            router.push(`/journal/${appid}/guides/${source}/${guideId}` as never)
            return
        }
        if (/^https?:\/\//i.test(href)) {
            Linking.openURL(href)
            return
        }
        const hashIdx = href.indexOf('#')
        if (hashIdx === -1) {
            router.push(`/journal/${appid}/guides/${source}/${guideId}/${encodeURIComponent(href)}` as never)
            return
        }
        const targetAnchor = href.slice(hashIdx + 1)
        const basePage = href.slice(0, hashIdx)
        if (hashIdx === 0 || basePage === slug) {
            scrollToAnchor(targetAnchor)
        } else {
            router.push({
                pathname: '/journal/[appid]/guides/[source]/[guideId]/[slug]' as never,
                params: { appid: String(appid), source, guideId, slug: basePage, anchor: targetAnchor },
            } as never)
        }
    }

    function onImagePress(url: string) {
        openScreenshotLightbox([url], 0)
    }

    function onBlockLongPress(path: number[], label: string, anchor?: { x: number; y: number }) {
        const existing = pinFor(slug)
        // Store in the canonical WEB coordinate so the pin lands on the same block on web too.
        const webPath = nativePinToWeb(path, blocksQuery.data ?? [])
        // Anchor the menu at the finger (like the game-card menu) instead of the screen centre.
        openLongPressMenu([{
            label: existing ? 'Move pin here' : 'Pin this location',
            action: () => createPin(slug, sectionLabel, webPath, label),
        }], anchor)
    }

    if (metaQuery.isLoading || blocksQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading page…</Text></View>
    }
    if (metaQuery.isError || !metaQuery.data) {
        return <View style={styles.container}><Text style={styles.emptyText}>Guide not found.</Text></View>
    }

    const meta = metaQuery.data
    const blocks = blocksQuery.data ?? []
    const currentPin = pinFor(slug)
    // Highlight the pinned block in NATIVE coordinates (stored pins are web-coordinate — see helpers).
    const pinnedPathNative = currentPin ? webPinToNative(currentPin.blockPath, blocks) : null

    // Ported from sectionLabel's own lookup order: navTree labels first (richer, from the source's
    // own nav sidebar), falling back to meta.pages, falling back to the raw slug.
    function findLabel(): string {
        function walk(items: unknown): string | null {
            for (const item of (items as NavItem[] | undefined) ?? []) {
                if (item.type === 'link' && item.slug === slug) return item.label
                if (item.type === 'group') {
                    const hit = walk(item.children)
                    if (hit) return hit
                }
            }
            return null
        }
        return walk(meta.navTree) ?? meta.pages?.find(p => p.slug === slug)?.label ?? slug
    }
    const sectionLabel = findLabel()

    const crumbs: Crumb[] = [
        { label: 'Home', onPress: () => router.push('/' as never) },
        { label: gameName || 'Game', onPress: () => router.push(`/game/${appid}` as never) },
        { label: 'Journal', onPress: () => router.push(`/journal/${appid}` as never) },
        { label: 'Guides', onPress: () => router.push(`/journal/${appid}/guides` as never) },
        { label: meta.title, onPress: () => router.push(`/journal/${appid}/guides/${source}/${guideId}` as never) },
        { label: sectionLabel },
    ]

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.headerRow}>
                    <View style={styles.breadcrumbWrap}>
                        <Breadcrumb crumbs={crumbs} />
                    </View>
                    {!isWide && (
                        <Pressable style={styles.tocBtn} onPress={() => useGuideTocStore.getState().open(appid, source, guideId, meta, slug)}>
                            <Text style={styles.tocBtnText}>Contents · {meta.pages?.length ?? 0} pages</Text>
                        </Pressable>
                    )}
                </View>
                <Text style={styles.title}>{sectionLabel}</Text>
                {staleNotice && (
                    <View style={styles.staleBanner}>
                        <Text style={styles.staleBannerText}>Pins cleared — guide was re-downloaded.</Text>
                        <Pressable onPress={() => useGuidePinsStore.getState().dismissStaleNotice()} hitSlop={6}>
                            <Text style={styles.staleBannerClose}>✕</Text>
                        </Pressable>
                    </View>
                )}
            </View>
            <View style={[styles.body, isWide && styles.bodyWide]}>
                <View style={styles.mainCol}>
                    {blocks.length > 0 && (
                        <GuidePageSearch blocks={blocks} slug={slug} onJump={onSearchJump} gutter={gutter} />
                    )}
                    <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}>
                        {blocks.length === 0 ? (
                            <Text style={styles.emptyText}>This page hasn't been downloaded yet — refresh the guide to fetch it.</Text>
                        ) : (
                            <ContentBlockRenderer
                                blocks={blocks}
                                imgUrl={(localSrc) => guideImageUrl(apiHost ?? '', appid, source, guideId, slug, localSrc)}
                                onImagePress={onImagePress}
                                onLinkPress={onLinkPress}
                                onSectionRef={(id, node) => { if (node) anchorRefs.current.set(id, node); else anchorRefs.current.delete(id) }}
                                onBlockRef={(path, node) => {
                                    const key = JSON.stringify(path)
                                    if (node) blockRefs.current.set(key, node); else blockRefs.current.delete(key)
                                }}
                                onBlockOffset={(path, y) => blockOffsets.current.set(JSON.stringify(path), y)}
                                onBlockLongPress={onBlockLongPress}
                                onPinPress={() => { if (currentPin) deletePin(currentPin.id) }}
                                pinnedPath={pinnedPathNative}
                                contentWidth={blockContentW}
                            />
                        )}
                    </ScrollView>
                </View>

                {/* Persistent Contents column at tablet/desktop — full nav tree + Pins, always visible
                    (the web keeps this column on every guide page). Phone uses the bottom-sheet. */}
                {isWide && (
                    <View style={styles.tocPanel}>
                        <Text style={styles.contentsHeading}>Contents</Text>
                        <GuideTocPanel
                            appid={appid}
                            source={source}
                            guideId={guideId}
                            meta={meta}
                            currentSlug={slug}
                            scrollStyle={styles.tocPanelScroll}
                        />
                    </View>
                )}
            </View>
        </View>
    )
}

// Port of Breadcrumb.svelte — pill trail (Home › Game › Journal › Guides › {title} › {section}).
// Horizontally scrollable so the long guide trail never overflows the header.
function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bcTrail}>
            {crumbs.map((c, i) => (
                <Fragment key={i}>
                    {i > 0 && <Text style={styles.bcSep}>›</Text>}
                    {c.onPress ? (
                        <Pressable onPress={c.onPress}><Text style={styles.bcCrumb} numberOfLines={1}>{c.label}</Text></Pressable>
                    ) : (
                        <Text style={[styles.bcCrumb, styles.bcCrumbCurrent]} numberOfLines={1}>{c.label}</Text>
                    )}
                </Fragment>
            ))}
        </ScrollView>
    )
}

// ── In-page search ──────────────────────────────────────────────────────────────
// Port of GuidePageSearch.svelte — a "Search this page…" bar over the CURRENT section's already-
// loaded content blocks (no fetch), with match-count + prev/next nav and jump-to-block. The web's
// keyboard affordances (↑/↓ to move the active result, Enter to jump) are replaced by ‹/› buttons
// and tap-to-jump, the touch equivalents (see this file's own header note on dropped keyboard nav).

type PageEntry = { text: string; blockPath: number[] }
type PageHit = { before: string; match: string; after: string; blockPath: number[] }

function stripHtml(s: string): string {
    return (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function flattenListText(items: ListItem[]): string {
    return items.flatMap(item => {
        const parts = [stripHtml(item.text ?? '')]
        if (item.children?.items?.length) parts.push(flattenListText(item.children.items))
        return parts
    }).filter(Boolean).join(' ')
}

// Mirrors guide-blocks-search.ts's extractPageEntries, but emits **native data-tree** blockPaths
// (the exact index paths ContentBlockRenderer registers via onBlockRef) rather than the web's
// _fulltext DOM coordinate — the web offsets a section's children by +1 for the heading's DOM
// child[0], but native renders the heading INSIDE the section View (no separate child), so a
// section's heading maps to the section's own path and its children start at index 0. Using the
// native coordinate here is what makes scrollToBlockPath resolve the right block.
function extractBlockEntries(block: ContentBlock, path: number[], out: PageEntry[]): void {
    switch (block.type) {
        case 'section': {
            if (block.heading) out.push({ text: block.heading, blockPath: path })
            const children = block.children ?? []
            children.forEach((child, j) => extractBlockEntries(child, [...path, j], out))
            break
        }
        case 'heading': {
            // level 1 is the page title (not rendered in the content stream) — skip, matching the renderer.
            if (block.level !== 1 && block.text) out.push({ text: block.text, blockPath: path })
            break
        }
        case 'paragraph': {
            const text = stripHtml(block.html)
            if (text.length > 10) out.push({ text, blockPath: path })
            break
        }
        case 'list': {
            const text = flattenListText(block.items)
            if (text.length > 3) out.push({ text, blockPath: path })
            break
        }
        case 'image': {
            const text = [block.caption, block.alt].filter(Boolean).join(' ')
            if (text) out.push({ text, blockPath: path })
            break
        }
        case 'table': {
            const cells = [...(block.headers ?? []), ...block.rows.flat()]
            const text = cells.map(c => stripHtml((c?.html ?? c?.text) ?? '')).filter(Boolean).join(' · ')
            if (text) out.push({ text, blockPath: path })
            break
        }
    }
}

function extractPageEntries(blocks: ContentBlock[]): PageEntry[] {
    const out: PageEntry[] = []
    blocks.forEach((block, i) => extractBlockEntries(block, [i], out))
    return out
}

// Ported verbatim from GuidePageSearch.svelte's makeSnippet — a ±80-char window around the first
// match, with leading/trailing ellipses when truncated. Returns styled parts instead of an HTML
// string (plain <Text> spans render the same result on RN).
function makeSnippetParts(text: string, indices: readonly [number, number][]): { before: string; match: string; after: string } {
    if (!indices?.length) return { before: text.slice(0, 180), match: '', after: '' }
    const R = 80
    const [s, e] = indices[0]
    const from = Math.max(0, s - R)
    const to = Math.min(text.length, e + 1 + R)
    return {
        before: (from > 0 ? '…' : '') + text.slice(from, s),
        match: text.slice(s, e + 1),
        after: text.slice(e + 1, to) + (to < text.length ? '…' : ''),
    }
}

function GuidePageSearch({ blocks, slug, onJump, gutter }: {
    blocks: ContentBlock[]
    slug: string
    onJump: (blockPath: number[]) => void
    gutter: number
}) {
    const [query, setQuery] = useState('')
    const [hits, setHits] = useState<PageHit[]>([])
    const [activeIdx, setActiveIdx] = useState(-1)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Built synchronously from the already-loaded blocks — no loading state. Memoized per section.
    const fuse = useMemo(() => {
        const entries = extractPageEntries(blocks)
        return entries.length > 0
            ? new Fuse(entries, { keys: ['text'], includeMatches: true, includeScore: true, threshold: 0.3, minMatchCharLength: 3, ignoreLocation: true })
            : null
    }, [blocks])

    // Clear search state when the page changes so stale results don't linger (web parity).
    useEffect(() => {
        setQuery(''); setHits([]); setActiveIdx(-1)
    }, [slug])

    function runSearch(q: string) {
        if (!fuse || !q.trim()) { setHits([]); setActiveIdx(-1); return }
        const raw = fuse.search(q.trim(), { limit: 20 })
        const newHits: PageHit[] = raw.map(r => ({
            ...makeSnippetParts(r.item.text, (r.matches?.[0]?.indices ?? []) as [number, number][]),
            blockPath: r.item.blockPath,
        }))
        setHits(newHits)
        setActiveIdx(newHits.length > 0 ? 0 : -1)
    }

    function onChangeQuery(text: string) {
        setQuery(text)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => runSearch(text), 150)
    }

    function jumpTo(idx: number) {
        const hit = hits[idx]
        if (!hit) return
        setActiveIdx(idx)
        onJump(hit.blockPath)
    }

    // Cycle prev/next through the matches (wraps), scrolling to each — the touch equivalent of the
    // web's ↑/↓ arrow-key match nav.
    function step(delta: 1 | -1) {
        if (hits.length === 0) return
        jumpTo((activeIdx + delta + hits.length) % hits.length)
    }

    function clear() {
        setQuery(''); setHits([]); setActiveIdx(-1)
    }

    return (
        <View style={[styles.gpsWrap, { paddingHorizontal: gutter }]}>
            <View style={styles.gpsBar}>
                <Text style={styles.gpsIcon}>⌕</Text>
                <TextInput
                    style={styles.gpsInput}
                    placeholder="Search this page…"
                    placeholderTextColor={colors.textMuted}
                    value={query}
                    onChangeText={onChangeQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                />
                {hits.length > 0 && (
                    <>
                        <Text style={styles.gpsCount}>{activeIdx + 1}/{hits.length}{hits.length === 20 ? '+' : ''}</Text>
                        <Pressable onPress={() => step(-1)} hitSlop={8}><Text style={styles.gpsNav}>‹</Text></Pressable>
                        <Pressable onPress={() => step(1)} hitSlop={8}><Text style={styles.gpsNav}>›</Text></Pressable>
                    </>
                )}
                {!!query && (
                    <Pressable onPress={clear} hitSlop={8}><Text style={styles.gpsClear}>✕</Text></Pressable>
                )}
            </View>
            {hits.length > 0 ? (
                <ScrollView style={styles.gpsResults} keyboardShouldPersistTaps="handled">
                    {hits.map((hit, i) => (
                        <Pressable
                            key={i}
                            style={[styles.gpsResult, i === activeIdx && styles.gpsResultActive]}
                            onPress={() => jumpTo(i)}
                        >
                            <Text style={styles.gpsSnippet} numberOfLines={2}>
                                {hit.before}
                                <Text style={styles.gpsMark}>{hit.match}</Text>
                                {hit.after}
                            </Text>
                        </Pressable>
                    ))}
                </ScrollView>
            ) : (query.trim().length >= 2) ? (
                <Text style={styles.gpsEmpty}>No results for "{query}"</Text>
            ) : null}
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    header: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    breadcrumbWrap: { flex: 1, minWidth: 0 },
    tocBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 4, backgroundColor: colors.bgHover },
    tocBtnText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 20 },
    // Body: single column on phone; content + persistent Contents column on tablet/desktop.
    body: { flex: 1 },
    bodyWide: { flexDirection: 'row' },
    mainCol: { flex: 1, minWidth: 0 },
    tocPanel: { width: TOC_PANEL_WIDTH, borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: spacing.md, paddingTop: spacing.md },
    tocPanelScroll: { flex: 1 },
    contentsHeading: { color: colors.text, fontFamily: fonts.title, fontSize: 18, letterSpacing: 0.5, marginBottom: spacing.xs, paddingHorizontal: spacing.md },
    // Breadcrumb pills (public/css/breadcrumb.css).
    bcTrail: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    bcCrumb: {
        paddingHorizontal: 11, paddingVertical: 4, borderRadius: 20,
        fontSize: 10.5, fontFamily: fonts.uiBold, letterSpacing: 0.7, textTransform: 'uppercase',
        borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.textMuted,
        overflow: 'hidden',
    },
    bcCrumbCurrent: { backgroundColor: colors.accentBg, borderColor: 'rgba(201, 168, 76, 0.4)', color: colors.accent },
    bcSep: { color: colors.textMuted, fontSize: 14, opacity: 0.4 },
    staleBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(230,180,60,0.15)', borderRadius: 4, padding: spacing.xs, marginTop: spacing.sm },
    staleBannerText: { color: '#e6b43c', fontFamily: fonts.ui, fontSize: 11, flex: 1 },
    staleBannerClose: { color: '#e6b43c', fontSize: 14, paddingHorizontal: spacing.xs },
    scroll: { flex: 1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    gpsWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.bg },
    gpsBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm },
    gpsIcon: { color: colors.textMuted, fontSize: 15 },
    gpsInput: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 13, paddingVertical: spacing.sm },
    gpsCount: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    gpsNav: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 18, paddingHorizontal: 4 },
    gpsClear: { color: colors.textMuted, fontSize: 14, paddingHorizontal: 2 },
    gpsResults: { maxHeight: 200, marginTop: spacing.xs, backgroundColor: colors.bgRaised, borderRadius: radius, borderWidth: 1, borderColor: colors.border },
    gpsResult: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    gpsResultActive: { backgroundColor: colors.bgHover },
    gpsSnippet: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
    gpsMark: { color: '#1a1208', backgroundColor: '#f0c040', fontFamily: fonts.uiBold },
    gpsEmpty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: spacing.xs, textAlign: 'center' },
})
