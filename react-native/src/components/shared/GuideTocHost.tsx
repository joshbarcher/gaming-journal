import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { useGuidePinsStore } from '@/store/guidePinsStore'
import { useGuideTocStore } from '@/store/guideTocStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { NavItem } from 'gaming-journal-contracts/guideMeta'

// Root-mounted overlay (see guideTocStore.ts) — port of GuideViewer.svelte's TOC sidebar,
// redesigned as a bottom-sheet drawer (this item's own stated scope) rather than the web's
// permanent 300px/40px collapsible grid column. Pins section added by the Guide Pins item —
// reads `useGuidePinsStore` directly (the "current guide" pins, populated by whichever guide
// screen — landing or section — is mounted, independent of this drawer's own open/close state).
export function GuideTocHost() {
    const { visible, appid, source, guideId, meta, currentSlug, close } = useGuideTocStore()
    const { pins, staleNotice, deletePin, requestScroll, dismissStaleNotice } = useGuidePinsStore()
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
    const [pinsOpen, setPinsOpen] = useState(true)

    // Port of autoOpenGroupFor(): open every group on the path to the current slug — groups nest
    // (IGN: Walkthrough › Calendar › June) — each time the drawer opens for a given page. Not all
    // groups, just the ancestors, matching the web exactly.
    useEffect(() => {
        if (!visible || !meta?.navTree) return

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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the drawer opens or the target page changes
    }, [visible, currentSlug])

    if (!visible || !appid || !meta) return null

    function toggleGroup(key: string) {
        setOpenGroups(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    function navTo(slug: string) {
        close()
        router.push(`/journal/${appid}/guides/${source}/${guideId}/${encodeURIComponent(slug)}` as never)
    }

    // Port of navToPin(): same-page taps just request a scroll on the already-mounted section
    // screen (pub/sub via the store — this drawer has no direct ScrollView handle); cross-page taps
    // navigate normally and let the destination screen find its own saved pin on mount (already-
    // built auto-scroll behavior), which is simpler than threading a pendingPinPath signal through.
    function navToPin(pin: { slug: string; blockPath: number[] }) {
        if (pin.slug === currentSlug) {
            close()
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
        <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} />
            <View style={styles.sheet}>
                <View style={styles.header}>
                    <Text style={styles.title}>Contents</Text>
                    <Pressable onPress={close} hitSlop={8}><Text style={styles.closeBtn}>✕</Text></Pressable>
                </View>
                <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                    {staleNotice && (
                        <View style={styles.staleBanner}>
                            <Text style={styles.staleBannerText}>Pins cleared — guide was re-downloaded.</Text>
                            <Pressable onPress={dismissStaleNotice} hitSlop={6}><Text style={styles.staleBannerClose}>✕</Text></Pressable>
                        </View>
                    )}
                    {pins.length > 0 && (
                        <View style={styles.pinsSection}>
                            <Pressable style={styles.pinsHd} onPress={() => setPinsOpen(o => !o)}>
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
                            <NavRow key={i} item={item} currentSlug={currentSlug} openGroups={openGroups} onToggleGroup={toggleGroup} onNav={navTo} depth={0} />
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
            </View>
        </View>
    )
}

// Groups nest, so labels alone can collide across branches — key by slug when present.
function groupKey(item: any): string {
    return item.slug ?? item.label
}

function NavRow({ item, currentSlug, openGroups, onToggleGroup, onNav, depth }: {
    item: NavItem
    currentSlug: string | null
    openGroups: Set<string>
    onToggleGroup: (key: string) => void
    onNav: (slug: string) => void
    depth: number
}) {
    if (item.type === 'label') {
        return <Text style={styles.label}>{item.label}</Text>
    }
    if (item.type === 'link') {
        return (
            <Pressable style={[styles.link, depth > 0 && styles.linkChild]} onPress={() => onNav(item.slug)}>
                <Text style={[styles.linkText, item.slug === currentSlug && styles.linkTextActive]}>{item.label}</Text>
            </Pressable>
        )
    }
    // group — header only ever toggles open/closed, never navigates directly, matching
    // `.gv-toc-group-hd`'s real onclick (toggleGroup only, even when item.slug exists).
    const key  = groupKey(item)
    const open = openGroups.has(key)
    return (
        <View style={depth > 0 && styles.groupNested}>
            <Pressable style={styles.groupHd} onPress={() => onToggleGroup(key)}>
                <Text style={styles.groupHdText}>{open ? '▾' : '▸'} {item.label}</Text>
            </Pressable>
            {open && item.children?.map((child, i) => (
                <NavRow key={i} item={child} currentSlug={currentSlug} openGroups={openGroups} onToggleGroup={onToggleGroup} onNav={onNav} depth={depth + 1} />
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
    list: { flexGrow: 0 },
    listContent: { padding: spacing.md, paddingBottom: spacing.xl },
    label: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase', marginTop: spacing.sm, marginBottom: 4 },
    link: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius },
    linkChild: { paddingLeft: spacing.md },
    linkText: { color: colors.text, fontFamily: fonts.ui, fontSize: 14 },
    linkTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    groupHd: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
    groupNested: { paddingLeft: spacing.md },
    groupHdText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
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
