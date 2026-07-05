import { Image } from 'expo-image'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { fmtScore, fmtTime, resolveMediaUrl, thumbPath } from '@/utils/communityRender'
import type { RedditPost } from 'gaming-journal-contracts/reddit'
import type { LoadedPrefs } from '@/api/communityPrefs'

// Port of CommunityPage.svelte's post-card markup. Long-press replaces the web's
// oncontextmenu-on-[data-author] handler — same 4 actions (filter/mute/highlight/favorite),
// computed here per-post instead of via a document-level contextmenu delegate.
export function PostCard({
    post, appid, prefs, apiHost,
    onToggleFilter, onToggleMute, onToggleHighlight, onToggleFavorite,
}: {
    post:    RedditPost
    appid:   number
    prefs:   LoadedPrefs
    apiHost: string | undefined
    onToggleFilter:    (username: string) => void
    onToggleMute:      (username: string) => void
    onToggleHighlight: (username: string) => void
    onToggleFavorite:  (username: string) => void
}) {
    const author = post.author ?? ''
    const thumb = resolveMediaUrl(thumbPath(post), apiHost)
    const isFiltered    = author ? prefs.filtered.has(author) : false
    const isMuted       = author ? prefs.muted.has(author) : false
    const isFavorited   = author ? prefs.favorited.has(author) : false
    const isHighlighted = author ? prefs.highlighted.has(author) : false

    function openMenu() {
        if (!author || author === '[deleted]') return
        openLongPressMenu([
            { label: isFiltered ? `Remove filter on u/${author}` : `Filter u/${author}`, action: () => onToggleFilter(author) },
            { label: isMuted ? `Unmute u/${author}` : `Mute u/${author}`, action: () => onToggleMute(author) },
            'separator',
            { label: isHighlighted ? 'Remove highlight (this game)' : `Highlight u/${author} (this game)`, action: () => onToggleHighlight(author) },
            { label: isFavorited ? `Remove favorite on u/${author}` : `Favorite u/${author}`, action: () => onToggleFavorite(author) },
        ])
    }

    return (
        <Pressable
            style={[styles.card, isFiltered && styles.cardFiltered, isMuted && styles.cardMuted, isHighlighted && styles.cardHighlighted]}
            onPress={() => router.push(`/community/${appid}/thread/${post.id}?sub=${encodeURIComponent(post.subreddit ?? '')}` as never)}
            onLongPress={openMenu}
        >
            {thumb && (
                <View style={styles.imgWrap}>
                    {post.isVideo && <Text style={styles.playBadge}>▶</Text>}
                    {post.isGallery && (post.galleryImages?.length ?? 0) > 1 && (
                        <Text style={styles.galleryBadge}>⊞ {post.galleryImages?.length}</Text>
                    )}
                    <Image source={{ uri: thumb }} style={styles.img} contentFit="cover" />
                </View>
            )}
            <View style={styles.content}>
                <Text style={styles.title} numberOfLines={2}>{post.title}</Text>
                {!!post.selftext && <Text style={styles.body} numberOfLines={2}>{post.selftext}</Text>}
                <View style={styles.meta}>
                    <Text style={styles.metaText}>▲ {fmtScore(post.score)}</Text>
                    <Text style={styles.metaText}>💬 {(post.numComments ?? 0).toLocaleString()}</Text>
                    <Text style={[styles.metaText, isFavorited && styles.metaFavorited]} numberOfLines={1}>u/{author}</Text>
                    <Text style={styles.metaTextMuted} numberOfLines={1}>r/{post.subreddit ?? ''}</Text>
                    <Text style={styles.metaTextMuted}>{fmtTime(post.createdUtc)}</Text>
                    {!!post.flair && <Text style={styles.flair} numberOfLines={1}>{post.flair}</Text>}
                </View>
            </View>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row', gap: spacing.sm, padding: spacing.sm,
        borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    cardFiltered:    { opacity: 0.35 },
    cardMuted:       { opacity: 0.35 },
    cardHighlighted: { backgroundColor: 'rgba(201,168,76,0.08)' },
    imgWrap: { width: 96, height: 72, borderRadius: radius, overflow: 'hidden', backgroundColor: colors.bgHover },
    img: { width: '100%', height: '100%' },
    playBadge: {
        position: 'absolute', top: '50%', left: '50%', marginLeft: -8, marginTop: -8,
        color: '#fff', fontSize: 14, zIndex: 1,
    },
    galleryBadge: {
        position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.65)',
        color: '#fff', fontSize: 9, paddingHorizontal: 3, borderRadius: 3, zIndex: 1,
    },
    content: { flex: 1, minWidth: 0, gap: 3 },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13, lineHeight: 17 },
    body: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 16 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
    metaText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    metaFavorited: { color: colors.accent, fontFamily: fonts.uiBold },
    metaTextMuted: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, opacity: 0.7 },
    flair: { color: colors.accent, fontFamily: fonts.ui, fontSize: 10, backgroundColor: colors.accentBg, paddingHorizontal: 4, borderRadius: 3 },
})
