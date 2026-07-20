import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getSettings, patchSettings } from '@/api/settings'
import { useGuidePinsStore } from '@/store/guidePinsStore'
import { useGuideTocStore } from '@/store/guideTocStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { GuideMeta, NavItem } from 'gaming-journal-contracts/guideMeta'
import type { Settings } from 'gaming-journal-contracts/settings'

// Port of GuideViewer.svelte's TOC sidebar. Two presentations share one implementation:
//   • GuideTocPanel — the scrollable Pins + filtered nav tree. On the tablet/desktop tier the guide
//     screens embed it as a PERMANENT right-hand "Contents" column (the web keeps this always
//     visible); on phone it lives inside the summoned bottom-sheet (GuideTocHost) instead.
//   • GuideTocHost — the root-mounted phone bottom-sheet wrapper (driven by useGuideTocStore).
//
// The persistent panel must NOT close on navigation (there's nothing to close), so navigation
// closing is opt-in via `onNavigate` — the sheet passes its `close()`, the panel passes nothing.

// Groups nest, so labels alone can collide across branches — key by slug when present.
function groupKey(item: any): string {
    return item.slug ?? item.label
}

export function GuideTocPanel({
    appid, source, guideId, meta, currentSlug, onNavigate, scrollStyle,
}: {
    appid: number
    source: string
    guideId: string
    meta: GuideMeta
    currentSlug: string | null
    // Called after any nav target is chosen. The bottom-sheet passes close(); the persistent panel
    // passes nothing so the tree stays put across page jumps.
    onNavigate?: () => void
    // Lets the persistent panel flex to fill its column (the sheet leaves it content-sized).
    scrollStyle?: object
}) {
    const { pins, staleNotice, deletePin, requestScroll, dismissStaleNotice } = useGuidePinsStore()
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

    // The Pins dropdown's open/collapsed state is a single GLOBAL server pref (guidePinsCollapsed),
    // shared with the web and synced across devices via /api/settings. Default open until settings
    // load. Ported from GuideViewer.svelte's loadPinsPref()/togglePins().
    const queryClient = useQueryClient()
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const pinsOpen = !(settingsQuery.data?.guidePinsCollapsed ?? false)

    async function togglePins() {
        const collapsed = pinsOpen // toggling from open collapses; from collapsed opens
        const prev = settingsQuery.data
        // Optimistic, targeted cache patch (no invalidate) so every screen reading ['settings']
        // reflects the change instantly; reconcile with the relay's authoritative response.
        queryClient.setQueryData<Settings>(['settings'], s => (s ? { ...s, guidePinsCollapsed: collapsed } : s))
        try {
            queryClient.setQueryData<Settings>(['settings'], await patchSettings({ guidePinsCollapsed: collapsed }))
        } catch {
            if (prev) queryClient.setQueryData<Settings>(['settings'], prev)
        }
    }

    // Port of autoOpenGroupFor(): open every group on the path to the current slug — groups nest
    // (IGN: Walkthrough › Calendar › June). Re-runs when the current page changes so the tree keeps
    // the active branch expanded as the user navigates within the persistent panel.
    useEffect(() => {
        if (!meta?.navTree) return

        function pathTo(items: NavItem[]): string[] | null {
            for (const item of items) {
                if (item.type === 'group') {
                    if (item.slug === currentSlug) return [groupKey(item)]
                    const below = pathTo((item.children ?? []) as NavItem[])
                    if (below) return [groupKey(item), ...below]
                } else if ((item as any).slug === currentSlug) {
                    return []
                }
            }
            return null
        }

        const toOpen = pathTo(meta.navTree as NavItem[])
        if (toOpen?.length) setOpenGroups(prev => new Set([...prev, ...toOpen]))
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the target page or tree changes
    }, [currentSlug, meta])

    function toggleGroup(key: string) {
        setOpenGroups(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    function navTo(slug: string) {
        onNavigate?.()
        router.push(`/journal/${appid}/guides/${source}/${guideId}/${encodeURIComponent(slug)}` as never)
    }

    // Port of navToPin(): same-page taps just request a scroll on the already-mounted section screen
    // (pub/sub via the store); cross-page taps navigate normally and let the destination screen find
    // its own saved pin on mount.
    function navToPin(pin: { slug: string; blockPath: number[] }) {
        if (pin.slug === currentSlug) {
            onNavigate?.()
            requestScroll(pin.blockPath)
        } else {
            navTo(pin.slug)
        }
    }

    // Ported from filteredNavTree: strip nav items whose slug isn't in meta.pages[] (pages that
    // exist in the source's sidebar but weren't successfully downloaded), removing groups left with
    // no valid children. Falls back to a flat meta.pages list if navTree is absent entirely.
    const pageSet = new Set((meta.pages ?? []).map(p => p.slug))
    function validSlug(slug: string | undefined): boolean {
        if (!slug) return false
        return pageSet.has(slug) || pageSet.has(slug.split('#')[0])
    }
    function filterItems(items: NavItem[]): NavItem[] {
        const out: NavItem[] = []
        for (const item of items) {
            if (item.type === 'label') { out.push(item); continue }
            if (item.type === 'link') { if (validSlug(item.slug)) out.push(item); continue }
            if (item.type === 'group') {
                const children = filterItems(item.children ?? [])
                if (validSlug(item.slug) || children.length > 0) out.push({ ...item, children })
            }
        }
        return out
    }
    const filteredNavTree = meta.navTree ? filterItems(meta.navTree as NavItem[]) : null

    return (
        <ScrollView style={[styles.list, scrollStyle]} contentContainerStyle={styles.listContent}>
            {staleNotice && (
                <View style={styles.staleBanner}>
                    <Text style={styles.staleBannerText}>Pins cleared — guide was re-downloaded.</Text>
                    <Pressable onPress={dismissStaleNotice} hitSlop={6}><Text style={styles.staleBannerClose}>✕</Text></Pressable>
                </View>
            )}
            {pins.length > 0 && (
                <View style={styles.pinsSection}>
                    <Pressable style={styles.pinsHd} onPress={togglePins}>
                        <Text style={styles.pinsTitle}>Pins</Text>
                        <View style={styles.pinsCountBadge}><Text style={styles.pinsCountText}>{pins.length}</Text></View>
                        <Text style={styles.pinsChevron}>{pinsOpen ? '▾' : '▸'}</Text>
                    </Pressable>
                    {pinsOpen && pins.map(pin => (
                        <View key={pin.id} style={styles.pinRow}>
                            <Pressable style={styles.pinNav} onPress={() => navToPin(pin)}>
                                <Text style={styles.pinPage} numberOfLines={1}>{pin.pageLabel}</Text>
                                <Text style={styles.pinLabel} numberOfLines={1}>{pin.label}</Text>
                            </Pressable>
                            <Pressable onPress={() => deletePin(pin.id)} hitSlop={8}>
                                <Text style={styles.pinDel}>✕</Text>
                            </Pressable>
                        </View>
                    ))}
                    <View style={styles.pinsRule} />
                </View>
            )}
            {filteredNavTree?.length ? (
                filteredNavTree.map((item, i) => (
                    <NavRow key={i} item={item} currentSlug={currentSlug} openGroups={openGroups} onToggleGroup={toggleGroup} onNav={navTo} validSlug={validSlug} depth={0} />
                ))
            ) : (
                (meta.pages ?? []).map(p => (
                    <Pressable key={p.slug} style={styles.link} onPress={() => navTo(p.slug)}>
                        <Text style={[styles.linkText, p.slug === currentSlug && styles.linkTextActive]}>{p.label}</Text>
                    </Pressable>
                ))
            )}
            {!!meta.author && <Text style={styles.author}>by {meta.author}</Text>}
        </ScrollView>
    )
}

// Root-mounted phone bottom-sheet (see guideTocStore.ts). Only used at phone tiers — the tablet/
// desktop guide screens render GuideTocPanel as a permanent side column instead.
export function GuideTocHost() {
    const { visible, appid, source, guideId, meta, currentSlug, close } = useGuideTocStore()

    if (!visible || !appid || !meta) return null

    return (
        <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} />
            <View style={styles.sheet}>
                <View style={styles.header}>
                    <Text style={styles.title}>Contents</Text>
                    <Pressable onPress={close} hitSlop={8}><Text style={styles.closeBtn}>✕</Text></Pressable>
                </View>
                <GuideTocPanel
                    appid={appid}
                    source={source}
                    guideId={guideId}
                    meta={meta}
                    currentSlug={currentSlug}
                    onNavigate={close}
                />
            </View>
        </View>
    )
}

function NavRow({ item, currentSlug, openGroups, onToggleGroup, onNav, validSlug, depth }: {
    item: NavItem
    currentSlug: string | null
    openGroups: Set<string>
    onToggleGroup: (key: string) => void
    onNav: (slug: string) => void
    validSlug: (slug: string | undefined) => boolean
    depth: number
}) {
    if (item.type === 'label') {
        return <Text style={styles.label}>{item.label}</Text>
    }
    if (item.type === 'link') {
        const active = item.slug === currentSlug
        return (
            <Pressable style={[styles.link, depth > 0 && styles.linkChild, active && styles.linkActive]} onPress={() => onNav(item.slug)}>
                <Text style={[styles.linkText, depth > 0 && styles.linkTextChild, active && styles.linkTextActive]}>{item.label}</Text>
            </Pressable>
        )
    }
    // group — matches web `.gv-toc-group-hd`: a slug-BEARING header is a real page and NAVIGATES on tap
    // (web `.gv-toc-group-hd--link`); a slug-LESS header only toggles. The chevron always toggles so a
    // navigable group can still be expanded without leaving the page (touch has no hover).
    const key  = groupKey(item)
    const open = openGroups.has(key)
    const navigable = validSlug(item.slug)
    const active = item.slug === currentSlug
    return (
        <View style={depth > 0 ? styles.groupNested : undefined}>
            <View style={[styles.groupHd, depth > 0 && styles.groupHdNested, active && styles.groupHdActive]}>
                <Pressable
                    style={styles.groupHdLabel}
                    onPress={() => (navigable ? onNav(item.slug!) : onToggleGroup(key))}
                >
                    <Text style={[styles.groupHdText, depth > 0 && styles.groupHdTextNested]} numberOfLines={2}>{item.label}</Text>
                </Pressable>
                <Pressable onPress={() => onToggleGroup(key)} hitSlop={8} style={styles.groupHdChevron}>
                    <Text style={styles.groupChevron}>{open ? '▾' : '▸'}</Text>
                </Pressable>
            </View>
            {open && item.children?.map((child, i) => (
                <NavRow key={i} item={child} currentSlug={currentSlug} openGroups={openGroups} onToggleGroup={onToggleGroup} onNav={onNav} validSlug={validSlug} depth={depth + 1} />
            ))}
        </View>
    )
}

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFill,
        ...(Platform.OS === 'web' ? { position: 'fixed' as 'absolute' } : null),
        backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', zIndex: 50,
    },
    sheet: { maxHeight: '75%', backgroundColor: colors.bgRaised, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    closeBtn: { color: colors.textMuted, fontSize: 18, padding: 4 },
    // The base must NOT hardcode `flexGrow: 0` — the persistent tablet panel passes `scrollStyle:
    // { flex: 1 }`, and `{ flexGrow: 0 }` + `{ flex: 1 }` resolve to flexBasis:0 with no grow → the
    // whole Contents column collapses to zero height (the bug where the tablet TOC rendered blank).
    // `flexShrink: 1` + `minHeight: 0` instead lets the persistent panel's flex:1 fill its column AND
    // lets the phone bottom-sheet's ScrollView shrink within the sheet's maxHeight so it can scroll.
    list: { flexShrink: 1, minHeight: 0 },
    listContent: { padding: spacing.md, paddingBottom: spacing.xl },
    // web `.gv-toc-label`: dim gold, 9px/700 uppercase, letter-spacing.
    label: { color: 'rgba(201,168,76,0.7)', fontFamily: fonts.uiBold, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.sm, marginBottom: 4 },
    // web `.gv-toc-link`: 12px (child 11px), dimmed text, tight 3px padding, active = accent + faint bg pill.
    link: { paddingVertical: 3, paddingHorizontal: 6, paddingLeft: 10, borderRadius: radius },
    linkChild: { paddingLeft: 14 },
    linkActive: { backgroundColor: 'rgba(201,168,76,0.08)' },
    linkText: { color: 'rgba(237,233,223,0.6)', fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
    linkTextChild: { fontSize: 11 },
    linkTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    // web `.gv-toc-group-hd`: bordered gold box (top-level); nested is fainter + fill-less.
    groupHd: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(201,168,76,0.03)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.28)', borderRadius: 4, paddingVertical: 6, paddingHorizontal: 10, marginTop: 4, marginBottom: 2 },
    groupHdNested: { backgroundColor: 'transparent', borderColor: 'rgba(201,168,76,0.15)' },
    groupHdActive: { backgroundColor: 'rgba(201,168,76,0.1)' },
    groupHdLabel: { flex: 1 },
    groupHdText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    groupHdTextNested: { fontSize: 11, fontFamily: fonts.ui, color: 'rgba(201,168,76,0.85)' },
    groupHdChevron: { paddingLeft: 8 },
    groupChevron: { color: 'rgba(201,168,76,0.7)', fontSize: 11 },
    groupNested: { paddingLeft: spacing.md },
    author: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: spacing.md, textAlign: 'center' },
    staleBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(230,180,60,0.15)', borderRadius: 4, padding: spacing.xs, marginBottom: spacing.sm },
    staleBannerText: { color: '#e6b43c', fontFamily: fonts.ui, fontSize: 11, flex: 1 },
    staleBannerClose: { color: '#e6b43c', fontSize: 14, paddingHorizontal: spacing.xs },
    pinsSection: { marginBottom: spacing.xs },
    pinsHd: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
    pinsTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    pinsCountBadge: { backgroundColor: colors.bgHover, borderRadius: 8, paddingHorizontal: 6, minWidth: 16, alignItems: 'center' },
    pinsCountText: { color: colors.textMuted, fontSize: 10, fontFamily: fonts.uiBold },
    pinsChevron: { color: colors.textMuted, fontSize: 12, marginLeft: 'auto' },
    pinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, paddingHorizontal: spacing.xs },
    pinNav: { flex: 1 },
    pinPage: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    pinLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    pinDel: { color: colors.textMuted, fontSize: 14, padding: 4 },
    pinsRule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
})
