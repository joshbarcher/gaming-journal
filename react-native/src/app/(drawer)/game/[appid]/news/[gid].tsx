import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { getGameDetail, getNewsArticle, type NewsBlock } from '@/api/gamePage'
import { RichHtml } from '@/components/game/About'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// Port of the /game/[appid]/news/[gid] route (NewsArticlePage.svelte) — the in-app article reader.
// The relay returns the body as parsed ContentBlocks; we reassemble them into one HTML string and
// hand it to RichHtml (react-native-render-html) for rich rendering, matching ContentBlocks.svelte's
// heading/paragraph/list/image handling. The "Read full article ↗" external link is kept (as on the
// web) as a secondary action — the primary experience is now in-app, not an external redirect.
//
// Web layout mirrored exactly (public/css/game.css): the whole page is a max-width 1000px centered
// `.nxd-page`; inside it the title + body cap at 840px and the hero at 900px, while the meta row runs
// the FULL page width so "Read full article" sits flush-right (`.nwa-src { margin-left: auto }`) past
// the narrower title column. A Breadcrumb replaces the phone "‹ Back" bar to match the web + the
// sibling mod-detail page convention.
const PAGE_MAX  = 1000  // web .nxd-page max-width
const TEXT_MAX  = 840   // web .nwa-title / .nwa-body max-width
const HERO_MAX  = 900   // web .nwa-hero max-width
const dateFmtLong = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

function articleImg(src: string | undefined, apiHost: string | undefined): string {
    if (!src) return ''
    return src.startsWith('http') ? src : (apiHost ? `${apiHost}${src}` : src)
}

function escapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
    return escapeText(s).replace(/"/g, '&quot;')
}

type ListItem = NonNullable<NewsBlock['items']>[number]
function listHtml(items: ListItem[], ordered: boolean): string {
    const tag = ordered ? 'ol' : 'ul'
    const lis = items.map(it => {
        const kids = it.children?.items?.length ? listHtml(it.children.items, it.children.ordered) : ''
        return `<li>${it.text ?? ''}${kids}</li>`
    }).join('')
    return `<${tag}>${lis}</${tag}>`
}

// paragraph.html and list item.text are already trusted HTML from the guide parser; heading/caption
// are plain text (escaped). Images resolve absolute Steam CDN URLs (or host-relative fallbacks).
function blocksToHtml(blocks: NewsBlock[], apiHost: string | undefined): string {
    return blocks.map(b => {
        switch (b.type) {
            case 'heading': {
                const lvl = b.level === 3 ? 3 : b.level === 4 ? 4 : 2
                return `<h${lvl}>${escapeText(b.text ?? '')}</h${lvl}>`
            }
            case 'paragraph':
                return b.html ? `<p>${b.html}</p>` : ''
            case 'list':
                return listHtml(b.items ?? [], b.ordered ?? false)
            case 'image': {
                if (!b.src) return ''
                const cap = b.caption ? `<figcaption>${escapeText(b.caption)}</figcaption>` : ''
                return `<figure><img src="${escapeAttr(articleImg(b.src, apiHost))}" alt="${escapeAttr(b.alt ?? '')}" />${cap}</figure>`
            }
            default:
                return ''
        }
    }).join('\n')
}

export default function NewsArticleScreen() {
    const { appid: appidStr, gid } = useLocalSearchParams<{ appid: string; gid: string }>()
    const appid = Number(appidStr)
    const apiHost = useApiHost().data
    const { width } = useWindowDimensions()
    const breakpoint = useBreakpoint()
    const collapsed = useSidebarStore(s => s.collapsed)

    const articleQuery = useQuery({
        queryKey: ['newsArticle', appid, gid],
        queryFn: () => getNewsArticle(appid, gid),
    })
    const article = articleQuery.data

    // Game name for the breadcrumb (web fetches /relay/api/games/{appid} for the same crumb).
    const gameName = useQuery({ queryKey: ['game', appid], queryFn: () => getGameDetail(appid) }).data?.name ?? 'Game'

    // Layout math mirrors the web's centered, max-width column (no onLayout needed): the page caps at
    // 1000px inside the drawer-flanked content area; the meta row uses that full inner width so the
    // src link reaches the right edge, while the body text/images cap at 840px like `.nwa-body`.
    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const rail = isPermanentRail ? (collapsed ? 68 : 280) : 0
    const pageW = Math.min(width - rail, PAGE_MAX)
    const innerW = Math.max(1, pageW - spacing.md * 2)
    const bodyW = Math.min(innerW, TEXT_MAX)

    const html = useMemo(() => (article ? blocksToHtml(article.blocks, apiHost) : ''), [article, apiHost])
    const heroUri = article ? articleImg(article.previewImage ?? undefined, apiHost) : ''
    const dateStr = article?.date ? dateFmtLong.format(new Date(article.date * 1000)) : ''

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.page}>
                <View style={styles.breadcrumb}>
                    <Pressable onPress={() => router.push(`/game/${appid}/news` as never)} hitSlop={8}>
                        <Text style={styles.crumb}>‹ {gameName} · News</Text>
                    </Pressable>
                </View>

                {articleQuery.isLoading ? (
                    <Text style={styles.muted}>Loading article…</Text>
                ) : articleQuery.isError || !article ? (
                    <Text style={styles.muted}>Couldn&apos;t load this article.</Text>
                ) : (
                    <>
                        <View style={styles.head}>
                            {!!article.feedlabel && <Text style={styles.feed}>{article.feedlabel}</Text>}
                            <Text style={[styles.title, { maxWidth: TEXT_MAX }]}>{article.title}</Text>
                            <View style={styles.metaRow}>
                                {!!dateStr && <Text style={styles.meta}>{dateStr}</Text>}
                                {!!article.author && <Text style={styles.meta}>· by {article.author}</Text>}
                                {!!article.url && (
                                    <Pressable
                                        onPress={() => Linking.openURL(article.url!)}
                                        hitSlop={6}
                                        style={isPermanentRail ? styles.srcRight : undefined}
                                    >
                                        <Text style={styles.srcLink}>Read full article ↗</Text>
                                    </Pressable>
                                )}
                            </View>
                        </View>

                        {!!heroUri && (
                            <Image
                                source={{ uri: heroUri }}
                                style={[styles.hero, { maxWidth: HERO_MAX }]}
                                contentFit="cover"
                                transition={150}
                            />
                        )}
                        <View style={{ maxWidth: TEXT_MAX, width: '100%' }}>
                            <RichHtml html={html} contentWidth={bodyW} />
                        </View>
                    </>
                )}
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacing.xl },
    // web .nxd-page: max-width 1000px, centered, 22px 30px padding.
    page: { width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md },
    breadcrumb: { marginBottom: spacing.sm },
    crumb: { color: colors.accent, fontFamily: fonts.ui, fontSize: 13 },
    muted: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, paddingVertical: spacing.md },
    // web .nwa-head: column, gap 10.
    head: { gap: spacing.sm, marginBottom: spacing.md },
    feed: { color: colors.accent, fontFamily: fonts.ui, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 26, lineHeight: 32 },
    // web .nwa-meta: full-width flex row, align center; .nwa-src { margin-left: auto } flushes right.
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    meta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    srcRight: { marginLeft: 'auto' },
    srcLink: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bgHover, borderRadius: radius, marginBottom: spacing.md },
})
