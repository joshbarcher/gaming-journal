import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getGuideMeta, getGuideSectionBlocks, guideImageUrl } from '@/api/guides'
import { ContentBlockRenderer } from '@/components/shared/ContentBlockRenderer'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { openScreenshotLightbox } from '@/store/screenshotLightboxStore'
import { useGuidePinsStore } from '@/store/guidePinsStore'
import { useGuideTocStore } from '@/store/guideTocStore'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, spacing } from '@/theme/tokens'
import type { NavItem } from 'gaming-journal-contracts/guideMeta'

const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam' }

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

    const metaQuery = useQuery({ queryKey: ['guideMeta', appid, source, guideId], queryFn: () => getGuideMeta(appid, source, guideId) })
    const blocksQuery = useQuery({
        queryKey: ['guideSection', appid, source, guideId, slug],
        queryFn: () => getGuideSectionBlocks(appid, source, guideId, slug),
    })

    const { pins, staleNotice, loadForGuide, createPin, scrollRequest } = useGuidePinsStore()
    const pinFor = useGuidePinsStore(s => s.pinFor)

    const scrollRef = useRef<ScrollView>(null)
    const anchorRefs = useRef<Map<string, View>>(new Map())
    const blockRefs = useRef<Map<string, View>>(new Map())

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

    function scrollToBlockPath(path: number[]) {
        const node = blockRefs.current.get(JSON.stringify(path))
        const scrollNode = scrollRef.current
        if (!node || !scrollNode) return
        node.measureLayout(scrollNode.getInnerViewNode?.() ?? scrollNode, (_x: number, y: number) => {
            scrollNode.scrollTo({ y: Math.max(0, y - 16), animated: true })
        })
    }

    // Scroll priority ported from loadSection(): an explicit anchor wins, then this page's own
    // saved pin, then top. (The web's 3rd priority, `pendingPinPath`, is redundant here — cross-page
    // pin navigation just does a normal route push and lets this same effect find the destination
    // page's own pin on mount, rather than threading a separate pending-path signal through.)
    useEffect(() => {
        if (!blocksQuery.data) return
        const t = setTimeout(() => {
            const pagePin = pinFor(slug)
            if (anchor) scrollToAnchor(anchor)
            else if (pagePin) scrollToBlockPath(pagePin.blockPath)
            else scrollRef.current?.scrollTo({ y: 0, animated: false })
        }, 50)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the actual section data identity changes
    }, [blocksQuery.data, anchor])

    // Pub/sub scroll request from the root-mounted TOC drawer — fires when the user taps a pin for
    // the page they're *already* viewing (see guidePinsStore.ts's own note on why this needs a
    // signal rather than a direct ref handle).
    useEffect(() => {
        if (scrollRequest) scrollToBlockPath(scrollRequest.path)
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

    function onBlockLongPress(path: number[], label: string) {
        const existing = pinFor(slug)
        openLongPressMenu([{
            label: existing ? 'Move pin here' : 'Pin this location',
            action: () => createPin(slug, sectionLabel, path, label),
        }])
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

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.headerRow}>
                    <Pressable style={styles.breadcrumbWrap} onPress={() => router.push(`/journal/${appid}/guides/${source}/${guideId}` as never)}>
                        <Text style={styles.breadcrumb}>‹ {meta.title} ({SOURCE_LABELS[source] ?? source})</Text>
                    </Pressable>
                    <Pressable style={styles.tocBtn} onPress={() => useGuideTocStore.getState().open(appid, source, guideId, meta, slug)}>
                        <Text style={styles.tocBtnText}>Contents{pins.length > 0 ? ` (${pins.length})` : ''}</Text>
                    </Pressable>
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
            <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
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
                        onBlockLongPress={onBlockLongPress}
                        pinnedPath={currentPin?.blockPath ?? null}
                        contentWidth={undefined}
                    />
                )}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    header: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    breadcrumbWrap: { flex: 1 },
    breadcrumb: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12 },
    tocBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 4, backgroundColor: colors.bgHover },
    tocBtnText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 20 },
    staleBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(230,180,60,0.15)', borderRadius: 4, padding: spacing.xs, marginTop: spacing.sm },
    staleBannerText: { color: '#e6b43c', fontFamily: fonts.ui, fontSize: 11, flex: 1 },
    staleBannerClose: { color: '#e6b43c', fontSize: 14, paddingHorizontal: spacing.xs },
    scroll: { flex: 1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
})
