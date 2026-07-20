import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native'

import {
    fmtCompact, fmtSize, galleryShotUri, getModDetail, getNexusData, nexusImageUri,
    type NexusModDetail,
} from '@/api/nexus'
import { ContentBlockRenderer, type ContentBlock } from '@/components/shared/ContentBlockRenderer'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useSidebarStore } from '@/store/sidebarStore'
import { openScreenshotLightbox } from '@/store/screenshotLightboxStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { useQuery } from '@tanstack/react-query'

// Port of ModDetailPage.svelte — the rich single-mod screen. Faithful to the web layout:
//   • a 2-column HERO (`.nxd-hero` = minmax(0,360px) 1fr, gap 28px) — image left, info right — that
//     collapses to a single stacked column on the phone/tablet-portrait tiers (web @media ≤720px);
//   • the info column: a category PILL, title, summary, a meta row (author + version/Vortex chips),
//     a stats row, and a SOLID-gold "View on Nexus Mods" button (web `.nxd-nexus-btn`);
//   • tag pills, then a Media gallery (author images are scraped in the background for non-adult
//     mods — poll until authorImagesAt resolves; adult galleries come from the Settings backfill and
//     aren't polled), and the BBCode description via the shared ContentBlockRenderer.
// The web caps `.nxd-page` at max-width 1000px centered and `.nxd-desc-body` at 820px — mirrored here
// so the hero image + text keep the web's proportions instead of stretching across a 1440dp tablet.
const PAGE_MAX = 1000   // web .nxd-page max-width
const DESC_MAX = 820    // web .nxd-desc-body max-width
const HERO_IMG_MAX = 360 // web .nxd-hero first column max
const HERO_GAP = 28     // web .nxd-hero gap
const GALLERY_MIN = 300 // web .game-shots-grid minmax(300px)
const GALLERY_GAP = 8   // web .game-shots-grid gap

function fmtDate(s?: string | null): string {
    if (!s) return ''
    try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
    catch { return '' }
}

export default function ModDetailScreen() {
    const { appid: appidStr, modId: modIdStr } = useLocalSearchParams<{ appid: string; modId: string }>()
    const appid = Number(appidStr)
    const modId = Number(modIdStr)
    const apiHost = useApiHost().data
    const { width } = useWindowDimensions()
    const breakpoint = useBreakpoint()
    const collapsed = useSidebarStore(s => s.collapsed)

    // ── Layout math (mirrors the web's centered, max-width column) ─────────────────────────────────
    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const rail = isPermanentRail ? (collapsed ? 68 : 280) : 0
    const isWideHero = isPermanentRail // web keeps the 2-col hero on the sidebar-permanent (wide) tiers
    const pageW = Math.min(width - rail, PAGE_MAX)
    const innerW = Math.max(1, pageW - spacing.md * 2) // content width after page padding
    // Image column is the web's fixed 360 on a roomy layout, but shrinks proportionally on the tighter
    // wide tiers so the info column never gets crushed; full width when the hero stacks.
    const heroImgW = isWideHero ? Math.min(HERO_IMG_MAX, Math.round(innerW * 0.42)) : innerW
    const galleryCols = Math.max(1, Math.floor((innerW + GALLERY_GAP) / (GALLERY_MIN + GALLERY_GAP)))
    const shotW = Math.floor((innerW - GALLERY_GAP * (galleryCols - 1)) / galleryCols)
    const descW = Math.min(innerW, DESC_MAX)

    const metaQuery = useQuery({ queryKey: ['nexus', appid], queryFn: () => getNexusData(appid) })
    const gameName = metaQuery.data?.steamName ?? metaQuery.data?.nexusName ?? 'Game'

    const [detail, setDetail] = useState<NexusModDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [imagesPending, setImagesPending] = useState(true) // scrape not yet resolved
    const [pollExhausted, setPollExhausted] = useState(false)
    const [heroUri, setHeroUri] = useState<string | null>(null)
    const heroTriedRef = useRef(false)
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true); setError(false)
            try {
                const d = await getModDetail(appid, modId)
                if (cancelled) return
                if (!d) { setError(true); return }
                setDetail(d)
                startAuthorImagePoll(d, 0)
            } catch {
                if (!cancelled) setError(true)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        // Adult mods aren't scraped on view (their images come from the authenticated Settings
        // backfill), so there's nothing to poll for — mirrors ModDetailPage.svelte's pollAuthorImages.
        function startAuthorImagePoll(d: NexusModDetail, tries: number) {
            if (d.adult || d.authorImagesAt) { setImagesPending(false); return }
            if (tries >= 20) { setPollExhausted(true); return } // ~60s
            pollTimerRef.current = setTimeout(async () => {
                try {
                    const fresh = await getModDetail(appid, modId)
                    if (cancelled || !fresh) return
                    if ((fresh.gallery?.length ?? 0) !== (d.gallery?.length ?? 0) || fresh.authorImagesAt) setDetail(fresh)
                    if (fresh.authorImagesAt) { setImagesPending(false); return }
                    startAuthorImagePoll(fresh, tries + 1)
                } catch {
                    startAuthorImagePoll(d, tries + 1)
                }
            }, 3000)
        }
        load()
        return () => { cancelled = true; if (pollTimerRef.current) clearTimeout(pollTimerRef.current) }
    }, [appid, modId])

    // Seed the hero image once detail + host resolve; the CDN fallback swap happens on <Image> error.
    useEffect(() => {
        if (!detail) return
        heroTriedRef.current = false
        setHeroUri(nexusImageUri(detail, apiHost))
    }, [detail, apiHost])

    if (loading) {
        return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
    }
    if (error || !detail) {
        return (
            <View style={styles.container}>
                <View style={styles.page}>
                    <Breadcrumb appid={appid} gameName={gameName} modName="Mod" />
                    <Text style={styles.empty}>Couldn't load this mod.</Text>
                </View>
            </View>
        )
    }

    const heroFallback = detail.imageUrl ?? detail.thumbUrl ?? null
    const gallery = detail.gallery ?? []
    const gallerySrcs = gallery.map(g => galleryShotUri(g, apiHost)).filter((u): u is string => !!u)
    const isAdult = detail.adult
    const blocks = (detail.descriptionBlocks ?? []) as unknown as ContentBlock[]

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.page}>
                <Breadcrumb appid={appid} gameName={gameName} modName={detail.name} />

                {/* ── Hero: image + info side-by-side on wide tiers, stacked on narrow ───────────── */}
                <View style={[styles.hero, isWideHero ? styles.heroWide : styles.heroStacked]}>
                    {!!heroUri && (
                        <View style={[styles.heroImgWrap, { width: heroImgW }]}>
                            <Image
                                source={{ uri: heroUri }}
                                style={styles.heroImg}
                                contentFit="cover"
                                blurRadius={isAdult ? 28 : 0}
                                onError={() => {
                                    if (heroFallback && !heroTriedRef.current && heroFallback !== heroUri) {
                                        heroTriedRef.current = true; setHeroUri(heroFallback)
                                    } else setHeroUri(null)
                                }}
                            />
                            {isAdult && <Text style={styles.adultBadge}>18+</Text>}
                        </View>
                    )}

                    <View style={styles.heroInfo}>
                        {!!detail.category && <Text style={styles.cat}>{detail.category}</Text>}
                        <Text style={styles.title}>{detail.name}</Text>
                        {!!detail.summary && <Text style={styles.summary}>{detail.summary}</Text>}

                        <View style={styles.metaRow}>
                            {!!detail.author && <Text style={styles.metaText}>by <Text style={styles.metaStrong}>{detail.author}</Text></Text>}
                            {!!detail.version && <Text style={styles.chip}>v{detail.version}</Text>}
                            {detail.supportsVortex && <Text style={[styles.chip, styles.chipOk]}>Vortex</Text>}
                        </View>

                        <View style={styles.statsRow}>
                            <Stat n={fmtCompact(detail.endorsements)} l="Endorsements" accent />
                            <Stat n={fmtCompact(detail.downloads)} l="Downloads" />
                            {!!detail.fileSize && <Stat n={fmtSize(detail.fileSize)} l="Size" />}
                            {!!detail.updatedAt && <Stat n={fmtDate(detail.updatedAt)} l="Updated" />}
                        </View>

                        <Pressable style={styles.nexusBtn} onPress={() => Linking.openURL(detail.url)}>
                            <Text style={styles.nexusBtnText}>View on Nexus Mods ↗</Text>
                        </Pressable>
                    </View>
                </View>

                {detail.tags.length > 0 && (
                    <View style={styles.tags}>
                        {detail.tags.map(t => <Text key={t} style={styles.tag}>{t}</Text>)}
                    </View>
                )}

                {/* ── Media ─────────────────────────────────────────────────────────────────────── */}
                <View style={styles.mediaSection}>
                    <View style={styles.sectionTitleRow}>
                        <Text style={styles.sectionTitle}>Media</Text>
                        {gallery.length > 0 && <Text style={styles.sectionCount}>{gallery.length}</Text>}
                        {!isAdult && imagesPending && !pollExhausted && (
                            <View style={styles.mediaStatus}>
                                <ActivityIndicator size="small" color={colors.textMuted} />
                                <Text style={styles.mediaStatusText}>fetching author images…</Text>
                            </View>
                        )}
                    </View>
                    {gallery.length > 0 ? (
                        <View style={styles.shotsGrid}>
                            {gallery.map((g, i) => {
                                const uri = galleryShotUri(g, apiHost)
                                if (!uri) return null
                                return (
                                    <Pressable key={i} style={[styles.shotItem, { width: shotW }]} onPress={() => openScreenshotLightbox(gallerySrcs, i)}>
                                        <Image source={{ uri }} style={styles.shotImg} contentFit="cover" cachePolicy="memory-disk" />
                                    </Pressable>
                                )
                            })}
                        </View>
                    ) : isAdult ? (
                        <Text style={styles.mediaNote}>Adult mod — its gallery is fetched during the authenticated backfill (Settings → Mod Images), not on view.</Text>
                    ) : imagesPending && !pollExhausted ? (
                        <Text style={styles.mediaNote}>Pulling images from Nexus — this can take a moment (they're fetched gently, one mod at a time).</Text>
                    ) : pollExhausted ? (
                        <Text style={styles.mediaNote}>Images are still being fetched in the background — refresh in a minute to see them.</Text>
                    ) : (
                        <Text style={styles.mediaNote}>No images available for this mod.</Text>
                    )}
                </View>

                {/* ── Description ───────────────────────────────────────────────────────────────── */}
                {blocks.length > 0 && (
                    <View style={styles.descSection}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <View style={[styles.descBody, { maxWidth: descW }]}>
                            <ContentBlockRenderer
                                blocks={blocks}
                                contentWidth={descW}
                                imgUrl={(localSrc) => (apiHost ? `${apiHost}/relay${localSrc}` : localSrc)}
                                onImagePress={(url) => openScreenshotLightbox([url], 0)}
                                onLinkPress={(href) => { if (href?.startsWith('http')) Linking.openURL(href) }}
                            />
                        </View>
                    </View>
                )}
            </View>
        </ScrollView>
    )
}

function Breadcrumb({ appid, gameName, modName }: { appid: number; gameName: string; modName: string }) {
    return (
        <View style={styles.breadcrumb}>
            <Pressable onPress={() => router.push(`/game/${appid}/mods` as never)} hitSlop={6}>
                <Text style={styles.crumb}>‹ {gameName} · Mods</Text>
            </Pressable>
            <Text style={styles.crumbCurrent} numberOfLines={1}>{modName}</Text>
        </View>
    )
}
function Stat({ n, l, accent }: { n: string; l: string; accent?: boolean }) {
    return (
        <View style={styles.stat}>
            <Text style={[styles.statN, accent && styles.statNAccent]}>{n}</Text>
            <Text style={styles.statL}>{l}</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    // Horizontal padding lives on the centered `page` (like the web's `.nxd-page`, whose max-width
    // includes its 30px padding) so innerW math stays consistent whether or not the cap bites.
    content: { paddingTop: spacing.md, paddingBottom: spacing.xxl },
    page: { width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center', paddingHorizontal: spacing.md },
    center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, fontStyle: 'italic', paddingVertical: spacing.xl },
    breadcrumb: { marginBottom: spacing.sm, gap: 2 },
    crumb: { color: colors.accent, fontFamily: fonts.ui, fontSize: 13 },
    crumbCurrent: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },

    // ── Hero (web .nxd-hero: 2-col grid, gap 28 / margin 18 0 26) ──────────────────────────────────
    hero: { marginTop: spacing.md, marginBottom: spacing.xl },
    heroWide: { flexDirection: 'row', alignItems: 'flex-start', gap: HERO_GAP },
    heroStacked: { flexDirection: 'column', gap: spacing.lg },
    heroImgWrap: { aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.bgHover },
    heroImg: { width: '100%', height: '100%' },
    adultBadge: {
        position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(224,80,80,0.9)', color: '#fff',
        fontFamily: fonts.uiBold, fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, overflow: 'hidden',
    },
    heroInfo: { flex: 1, minWidth: 0, gap: 12 },
    // web .nxd-cat: accent pill, NOT uppercase
    cat: {
        alignSelf: 'flex-start', color: colors.accent, backgroundColor: colors.accentBg,
        fontFamily: fonts.ui, fontSize: 11, letterSpacing: 0.4,
        paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden',
    },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 28, lineHeight: 32 },
    summary: { color: colors.text, fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 22, opacity: 0.9 },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
    metaText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    metaStrong: { color: colors.text, fontFamily: fonts.uiBold },
    // web .nxd-chip: bg-hover, 1px border, radius 6, 11px
    chip: {
        color: colors.text, fontFamily: fonts.ui, fontSize: 11, backgroundColor: colors.bgHover,
        borderWidth: 1, borderColor: colors.border, borderRadius: 6,
        paddingHorizontal: 9, paddingVertical: 2, overflow: 'hidden',
    },
    chipOk: { color: colors.progress, borderColor: colors.progressBg },
    // web .nxd-stats: gap 26
    statsRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: 26, marginTop: 4 },
    stat: { gap: 2 },
    statN: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 18 },
    statNAccent: { color: colors.accent },
    statL: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
    // web .nxd-nexus-btn: SOLID gold, dark text
    nexusBtn: {
        alignSelf: 'flex-start', marginTop: 6, backgroundColor: colors.accent,
        borderRadius: 9, paddingHorizontal: 18, paddingVertical: 10,
    },
    nexusBtnText: { color: '#1a160a', fontFamily: fonts.uiBold, fontSize: 13 },

    // web .nxd-tags: gap 7, margin 4 0 26; .nxd-tag: bg-raised, border, radius 999
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4, marginBottom: spacing.xl },
    tag: {
        color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, backgroundColor: colors.bgRaised,
        borderWidth: 1, borderColor: colors.border, borderRadius: 999,
        paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden',
    },

    // web .nxd-media / .nxd-desc: border-top + padding-top 24
    mediaSection: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xl, marginBottom: spacing.xl },
    descSection: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xl },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    sectionTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    sectionCount: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 13, marginBottom: spacing.sm },
    mediaStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    mediaStatusText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    mediaNote: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
    shotsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GALLERY_GAP },
    shotItem: { aspectRatio: 16 / 9, borderRadius: radius, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.bgHover },
    shotImg: { width: '100%', height: '100%' },
    descBody: { },
})
