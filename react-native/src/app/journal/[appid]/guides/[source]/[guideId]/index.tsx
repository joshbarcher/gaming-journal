import Fuse from 'fuse.js'
import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { getGuideFulltext, getGuideMeta } from '@/api/guides'
import { GuideMosaic } from '@/components/shared/GuideMosaic'
import { ShimmerTitle } from '@/components/shared/ShimmerTitle'
import { useApiHost } from '@/hooks/useApiHost'
import { useGuidePinsStore } from '@/store/guidePinsStore'
import { useGuideTocStore } from '@/store/guideTocStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { FtEntry } from 'gaming-journal-contracts/guideFulltext'

// Port of GuideLanding.svelte — the entry screen for a downloaded guide (no section selected yet).
// Read the real source directly (not just landing.md, which is accurate here but the exact
// snippet-window/grouping math is easiest to get right from the code itself).
const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam' }

function fmtBytes(n: number | undefined): string {
    if (!n) return ''
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

type HitSnippet = { before: string; match: string; after: string; blockPath?: number[] }
type HitGroup = { slug: string; label: string; snippets: HitSnippet[] }

// Ported verbatim from makeSnippet() — ±80 char window around the first match, leading/trailing
// ellipses when truncated. Returns parts instead of an HTML string (no {@html} equivalent needed
// on RN — plain styled Text spans render the same result).
function makeSnippetParts(text: string, indices: readonly [number, number][]): { before: string; match: string; after: string } {
    if (!indices?.length) return { before: text.slice(0, 160), match: '', after: '' }
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

export default function GuideLandingScreen() {
    const { appid: appidStr, source, guideId } = useLocalSearchParams<{ appid: string; source: string; guideId: string }>()
    const appid = Number(appidStr)
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data

    const metaQuery = useQuery({ queryKey: ['guideMeta', appid, source, guideId], queryFn: () => getGuideMeta(appid, source, guideId) })
    const loadPinsForGuide = useGuidePinsStore(s => s.loadForGuide)
    const pinCount = useGuidePinsStore(s => s.pins.length)

    // The web's sidebar shows the Pins section from the landing page too (sidebar state lives at
    // the whole-viewer level, not per-page) — load pins here as well, not just on the section
    // screen, so opening Contents from landing shows the real list immediately.
    useEffect(() => {
        if (metaQuery.data) loadPinsForGuide(appid, source, guideId, metaQuery.data.parsedAt ?? null)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when the guide identity or its real parsedAt changes
    }, [appid, source, guideId, metaQuery.data?.parsedAt])

    const [query, setQuery] = useState('')
    const [searchFocused, setSearchFocused] = useState(false)
    const [searchReady, setSearchReady] = useState(false)
    const [hits, setHits] = useState<HitGroup[]>([])
    const fuseRef = useRef<Fuse<FtEntry> | null>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Lazy-loaded on first focus, matching the web exactly — not cached across mounts, so
    // navigating away and back re-fetches (intentional: prevents stale results after a refresh).
    const fulltextQuery = useQuery({
        queryKey: ['guideFulltext', appid, source, guideId],
        queryFn: () => getGuideFulltext(appid, source, guideId),
        enabled: searchFocused,
    })

    if (fulltextQuery.data && !fuseRef.current) {
        fuseRef.current = new Fuse(fulltextQuery.data, {
            keys: ['text'], includeMatches: true, includeScore: true,
            threshold: 0.3, minMatchCharLength: 3, ignoreLocation: true,
        })
        setSearchReady(true)
    }

    function runSearch(q: string) {
        if (!fuseRef.current || !q.trim()) { setHits([]); return }
        const qLower = q.trim().toLowerCase()
        const raw = fuseRef.current.search(q.trim(), { limit: 60 })
        const groups = new Map<string, HitGroup>()
        const exactSlugs = new Set<string>()
        for (const r of raw) {
            const { slug, label, text } = r.item
            const indices = (r.matches?.[0]?.indices ?? []) as [number, number][]
            if (!groups.has(slug)) {
                if (groups.size >= 6) continue
                groups.set(slug, { slug, label, snippets: [] })
            }
            const g = groups.get(slug)!
            if (g.snippets.length < 3) {
                g.snippets.push({ ...makeSnippetParts(text, indices), blockPath: r.item.blockPath })
            }
            if (text.toLowerCase().includes(qLower)) exactSlugs.add(slug)
        }
        setHits([...groups.values()].sort((a, b) => Number(exactSlugs.has(b.slug)) - Number(exactSlugs.has(a.slug))))
    }

    function onChangeQuery(text: string) {
        setQuery(text)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        if (!searchReady) return
        debounceRef.current = setTimeout(() => runSearch(text), 180)
    }

    const meta = metaQuery.data
    const mosaicImages = useMemo(() => {
        if (!meta?.coverImages || !apiHost) return []
        return meta.coverImages.map((img, i) => {
            const filename = img.src.replace(/^img\//, '').replace(/\.[^.]+$/, '.webp')
            return { key: `${img.section}-${i}`, url: `${apiHost}/relay/guides-img/${appid}/${source}/${guideId}/${encodeURIComponent(img.section)}/img/${filename}` }
        })
    }, [meta?.coverImages, apiHost, appid, source, guideId])

    function navTo(slug: string) {
        router.push(`/journal/${appid}/guides/${source}/${guideId}/${slug}` as never)
    }

    if (metaQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading guide…</Text></View>
    }
    if (metaQuery.isError || !meta) {
        return <View style={styles.container}><Text style={styles.emptyText}>Guide not found.</Text></View>
    }

    const parsedDate = meta.parsedAt
        ? new Date(meta.parsedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : null

    return (
        <View style={styles.container}>
            <View style={styles.centeredHeader}>
                <Pressable
                    style={styles.tocBtn}
                    onPress={() => useGuideTocStore.getState().open(appid, source, guideId, meta, null)}
                >
                    <Text style={styles.tocBtnText}>Contents{pinCount > 0 ? ` (${pinCount})` : ''}</Text>
                </Pressable>
                <ShimmerTitle text={meta.title} style={styles.title} />

                <View style={styles.pills}>
                    <Text style={[styles.pill, styles.pillSource]}>{SOURCE_LABELS[source] ?? source}</Text>
                    <Text style={styles.pill}>{meta.pages?.length ?? 0} pages</Text>
                    {!!meta.sizeBytes && <Text style={styles.pill}>{fmtBytes(meta.sizeBytes)}</Text>}
                    {!!parsedDate && <Text style={styles.pill}>Synced {parsedDate}</Text>}
                    {!!meta.sourceUrl && (
                        <Pressable onPress={() => Linking.openURL(meta.sourceUrl!)}>
                            <Text style={[styles.pill, styles.pillLink]}>View original ↗</Text>
                        </Pressable>
                    )}
                </View>
            </View>

            <View style={styles.searchWrap}>
                <View style={styles.searchBar}>
                    <Text style={styles.searchIcon}>⌕</Text>
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search guide…"
                        placeholderTextColor={colors.textMuted}
                        value={query}
                        onChangeText={onChangeQuery}
                        onFocus={() => setSearchFocused(true)}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {!searchReady && !!query && <Text style={styles.searchLoading}>…</Text>}
                </View>

                {hits.length > 0 ? (
                    <ScrollView style={styles.results}>
                        {hits.map(group => (
                            <View key={group.slug} style={styles.resultGroup}>
                                <Pressable onPress={() => navTo(group.slug)}>
                                    <Text style={styles.resultPage}>{group.label}</Text>
                                </Pressable>
                                {group.snippets.map((s, i) => (
                                    <Pressable key={i} onPress={() => navTo(group.slug)} style={styles.snippet}>
                                        <Text style={styles.snippetText}>
                                            {s.before}
                                            <Text style={styles.snippetMark}>{s.match}</Text>
                                            {s.after}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        ))}
                    </ScrollView>
                ) : (query.trim() && searchReady) ? (
                    <Text style={styles.emptySearch}>No results for "{query}"</Text>
                ) : null}
            </View>

            <GuideMosaic images={mosaicImages} />
        </View>
    )
}

const styles = StyleSheet.create({
    // `alignItems:'center'` used to live on `container` directly — real bug caught during
    // verification: it also applied to GuideMosaic (a full-width, flex:1 sibling below), which
    // collapsed to a near-zero-width vertical sliver for the same reason ContentBlockRenderer's
    // images did (a percentage/flex-based child has nothing concrete to size against once its
    // parent stops stretching children to fill available width). Scoped centering to just the
    // title/pills header instead, leaving `container` at the default stretch behavior so
    // GuideMosaic gets a real width.
    container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
    centeredHeader: { alignItems: 'center' },
    tocBtn: { alignSelf: 'flex-end', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 4, backgroundColor: colors.bgHover, marginBottom: spacing.sm },
    tocBtnText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11 },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    title: { fontFamily: fonts.title, fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: spacing.md },
    pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs, marginBottom: spacing.lg },
    pill: {
        color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, backgroundColor: colors.bgHover,
        paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999,
    },
    pillSource: { color: colors.accent, borderWidth: 1, borderColor: colors.borderAct, backgroundColor: colors.accentBg },
    pillLink: { color: colors.accent },
    searchWrap: { width: '100%', maxWidth: 560, alignSelf: 'center', marginBottom: spacing.lg },
    searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm },
    searchIcon: { color: colors.textMuted, fontSize: 16 },
    searchInput: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 14, paddingVertical: spacing.sm },
    searchLoading: { color: colors.textMuted },
    results: { maxHeight: 260, marginTop: spacing.xs },
    resultGroup: { marginBottom: spacing.sm, backgroundColor: colors.bgRaised, borderRadius: radius, padding: spacing.sm, gap: 4 },
    resultPage: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    snippet: { paddingVertical: 2 },
    snippetText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
    snippetMark: { color: '#1a1208', backgroundColor: '#f0c040', fontFamily: fonts.uiBold },
    emptySearch: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, marginTop: spacing.xs, textAlign: 'center' },
})
