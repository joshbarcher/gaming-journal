import { useVideoPlayer, VideoView } from 'expo-video'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getThread } from '@/api/community'
import { loadPrefs, toggleFavorite, toggleFilter, toggleHighlight, toggleMute, type LoadedPrefs } from '@/api/communityPrefs'
import { getGameDetail } from '@/api/gamePage'
import { CommentView } from '@/components/community/CommentView'
import { Lucide } from '@/components/shared/Lucide'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { openScreenshotLightbox } from '@/store/screenshotLightboxStore'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { countComments, fmtScore, fmtTime, imgPath, resolveLocalOrUrl, resolveMediaUrl, videoPath } from '@/utils/communityRender'
import type { RedditComment, RedditPost } from 'gaming-journal-contracts/reddit'

// Port of CommunityThread.svelte + Comment.svelte (community/community.md "Thread view"). Image
// lightbox/carousel and gallery grid reuse the shared ScreenshotLightboxHost instead of the web's
// bespoke DOM-built modals — see CommentView.tsx's note, same reasoning applies to the full post's
// gallery here.
export default function ThreadScreen() {
    const { appid: appidStr, postId, sub } = useLocalSearchParams<{ appid: string; postId: string; sub?: string }>()
    const appid = Number(appidStr)
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data

    const [gameName, setGameName] = useState<string | null>(null)
    const [post, setPost] = useState<RedditPost | null>(null)
    const [subreddit, setSubreddit] = useState('')
    const [comments, setComments] = useState<RedditComment[]>([])
    const [commentCount, setCommentCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [refreshing, setRefreshing] = useState(false)
    const [refreshLabel, setRefreshLabel] = useState('↻ Refresh')
    // Author prefs (filter/mute/highlight/favorite) — the web thread offers these on EVERY author
    // (post + comments). Native previously had none in the thread, so a non-OP commenter couldn't be
    // actioned anywhere. Loaded once with the thread; toggles are optimistic with revert-on-throw.
    const [prefs, setPrefs] = useState<LoadedPrefs>({ filtered: new Set(), muted: new Set(), favorited: new Set(), highlighted: new Set() })

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true); setError(null)
            try {
                const [game, thread, loadedPrefs] = await Promise.all([
                    getGameDetail(appid),
                    getThread(appid, postId, sub ?? ''),
                    loadPrefs(appid),
                ])
                if (cancelled) return
                setGameName(game.name ?? null)
                setPost(thread.post)
                setSubreddit(thread.subreddit ?? sub ?? '')
                setComments(thread.comments)
                setCommentCount(countComments(thread.comments))
                setPrefs(loadedPrefs)
            } catch (err) {
                if (!cancelled) setError((err as Error).message)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [appid, postId, sub])

    function flipInSet(set: Set<string>, key: string): Set<string> {
        const next = new Set(set)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
    }
    async function onToggleFilter(author: string) {
        setPrefs(p => ({ ...p, filtered: flipInSet(p.filtered, author) }))
        try { await toggleFilter(author) } catch { setPrefs(p => ({ ...p, filtered: flipInSet(p.filtered, author) })) }
    }
    async function onToggleMute(author: string) {
        setPrefs(p => ({ ...p, muted: flipInSet(p.muted, author) }))
        try { await toggleMute(author) } catch { setPrefs(p => ({ ...p, muted: flipInSet(p.muted, author) })) }
    }
    async function onToggleFavorite(author: string) {
        setPrefs(p => ({ ...p, favorited: flipInSet(p.favorited, author) }))
        try { await toggleFavorite(author) } catch { setPrefs(p => ({ ...p, favorited: flipInSet(p.favorited, author) })) }
    }
    async function onToggleHighlight(author: string) {
        setPrefs(p => ({ ...p, highlighted: flipInSet(p.highlighted, author) }))
        try { await toggleHighlight(appid, author) } catch { setPrefs(p => ({ ...p, highlighted: flipInSet(p.highlighted, author) })) }
    }

    function openAuthorMenu(author: string) {
        if (!author || author === '[deleted]') return
        const isFiltered = prefs.filtered.has(author)
        const isMuted = prefs.muted.has(author)
        const isFavorited = prefs.favorited.has(author)
        const isHighlighted = prefs.highlighted.has(author)
        openLongPressMenu([
            { label: isFiltered ? `Remove filter on u/${author}` : `Filter u/${author}`, action: () => onToggleFilter(author) },
            { label: isMuted ? `Unmute u/${author}` : `Mute u/${author}`, action: () => onToggleMute(author) },
            'separator',
            { label: isHighlighted ? 'Remove highlight (this game)' : `Highlight u/${author} (this game)`, action: () => onToggleHighlight(author) },
            { label: isFavorited ? `Remove favorite on u/${author}` : `Favorite u/${author}`, action: () => onToggleFavorite(author) },
        ])
    }

    async function refresh() {
        setRefreshing(true); setRefreshLabel('↻ Fetching…')
        try {
            const thread = await getThread(appid, postId, sub ?? '', true)
            const existingIds = new Set(comments.map(c => c.id))
            const newComments = thread.comments.filter(c => !existingIds.has(c.id))
            if (newComments.length > 0) setComments(prev => [...prev, ...newComments])
            setCommentCount(countComments(thread.comments))
            setRefreshLabel(newComments.length > 0 ? `↻ +${newComments.length} new` : '↻ Up to date')
        } catch {
            setRefreshLabel('↻ Failed')
        } finally {
            setRefreshing(false)
            setTimeout(() => setRefreshLabel('↻ Refresh'), 3000)
        }
    }

    if (loading) {
        return <View style={styles.container}><ActivityIndicator color={colors.accent} /></View>
    }
    if (error || !post) {
        return <View style={styles.container}><Text style={styles.errorText}>Failed to load: {error ?? 'not found'}</Text></View>
    }

    const postVideoUri = resolveMediaUrl(videoPath(post) ?? post.videoUrl, apiHost)
    const gallery = post.isGallery ? (post.galleryImages ?? []) : []
    const postImgUri = !postVideoUri && !post.isGallery ? resolveMediaUrl(imgPath(post), apiHost) : null
    const galleryUris = gallery
        .map(g => resolveLocalOrUrl(g.localImage, g.url ?? g.thumbnail, apiHost))
        .filter((s): s is string => !!s)

    return (
        <ScrollView style={styles.container}>
            <View style={styles.nav}>
                <Pressable onPress={() => router.back()} hitSlop={8}><Text style={styles.backBtn}>‹ {gameName ?? 'Back'}</Text></Pressable>
            </View>

            <View style={styles.postCard}>
                <View style={styles.postHeader}>
                    {!!post.flair && <Text style={styles.flair}>{post.flair}</Text>}
                    <Text style={styles.postTitle}>{post.title}</Text>
                </View>

                {postVideoUri ? (
                    <ThreadVideo uri={postVideoUri} />
                ) : gallery.length > 0 ? (
                    <View style={styles.galleryGrid}>
                        {galleryUris.map((uri, i) => (
                            <Pressable key={i} style={styles.galleryItem} onPress={() => openScreenshotLightbox(galleryUris, i)}>
                                <Image source={{ uri }} style={styles.galleryImg} contentFit="cover" />
                            </Pressable>
                        ))}
                    </View>
                ) : postImgUri ? (
                    <Pressable style={styles.postImageWrap} onPress={() => openScreenshotLightbox([postImgUri], 0)}>
                        <Image source={{ uri: postImgUri }} style={styles.postImage} contentFit="cover" />
                    </Pressable>
                ) : null}

                {!!post.selftext && <Text style={styles.postBody}>{post.selftext}</Text>}

                <View style={styles.meta}>
                    <Text style={styles.metaText}>▲ {fmtScore(post.score)}</Text>
                    <View style={styles.metaIconText}>
                        <Lucide name="message-circle" color={colors.sky} size={14} />
                        <Text style={styles.metaText}>{(post.numComments ?? 0).toLocaleString()}</Text>
                    </View>
                    <Pressable onLongPress={() => openAuthorMenu(post.author ?? '')} hitSlop={4}>
                        <Text style={[styles.metaText, prefs.favorited.has(post.author ?? '') && styles.metaFavorited]}>
                            {prefs.favorited.has(post.author ?? '') ? '★ ' : ''}u/{post.author ?? ''}
                        </Text>
                    </Pressable>
                    <Text style={styles.metaTextMuted}>r/{subreddit || post.subreddit || ''}</Text>
                    <Text style={styles.metaTextMuted}>{fmtTime(post.createdUtc)}</Text>
                    {!!post.permalink && (
                        <Pressable onPress={() => Linking.openURL(post.permalink!)}>
                            <Text style={styles.redditLink}>View on Reddit ↗</Text>
                        </Pressable>
                    )}
                </View>
            </View>

            <View style={styles.commentsSection}>
                <View style={styles.commentsHeader}>
                    <Text style={styles.commentsHeading}>{commentCount} Comment{commentCount !== 1 ? 's' : ''}</Text>
                    <Pressable style={styles.refreshBtn} disabled={refreshing} onPress={refresh}>
                        <Text style={styles.refreshBtnText}>{refreshLabel}</Text>
                    </Pressable>
                </View>
                {comments.length === 0 ? (
                    <Text style={styles.emptyText}>No comments yet.</Text>
                ) : (
                    comments.map((c, i) => <CommentView key={c.id ?? i} comment={c} apiHost={apiHost} prefs={prefs} onAuthorMenu={openAuthorMenu} />)
                )}
            </View>
        </ScrollView>
    )
}

function ThreadVideo({ uri }: { uri: string }) {
    const player = useVideoPlayer(uri, p => { p.loop = true })
    return <VideoView player={player} style={styles.postVideo} nativeControls contentFit="contain" />
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    errorText: { color: colors.text, fontFamily: fonts.ui, textAlign: 'center', margin: spacing.lg },
    nav: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    backBtn: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    postCard: { padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    postHeader: { gap: 4 },
    flair: { alignSelf: 'flex-start', color: colors.accent, fontFamily: fonts.ui, fontSize: 10, backgroundColor: colors.accentBg, paddingHorizontal: 5, borderRadius: 3 },
    postTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 17, lineHeight: 23 },
    postVideo: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bgHover, borderRadius: radius },
    postImageWrap: { borderRadius: radius, overflow: 'hidden' },
    postImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bgHover },
    galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    galleryItem: { width: '49%', aspectRatio: 1, borderRadius: 4, overflow: 'hidden' },
    galleryImg: { width: '100%', height: '100%' },
    postBody: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, lineHeight: 19 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
    metaText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    metaIconText: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaFavorited: { color: '#e8b870', fontFamily: fonts.uiBold },
    metaTextMuted: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, opacity: 0.7 },
    redditLink: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11 },
    commentsSection: { padding: spacing.md },
    commentsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    commentsHeading: { color: colors.text, fontFamily: fonts.title, fontSize: 15 },
    refreshBtn: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius, backgroundColor: colors.bgHover },
    refreshBtnText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11 },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
})
