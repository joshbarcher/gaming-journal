import { Image } from 'expo-image'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Lucide } from '@/components/shared/Lucide'
import { openLongPressMenu } from '@/components/shared/LongPressMenu'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { fmtScore, fmtTime, resolveMediaUrl, thumbPath } from '@/utils/communityRender'
import type { RedditPost } from 'gaming-journal-contracts/reddit'
import type { LoadedPrefs } from '@/api/communityPrefs'

// Port of CommunityPage.svelte's `.community-post-card` — a VERTICAL card (large full-width image on
// top, then title / selftext / meta) laid out in the masonry grid (see community/[appid]/index.tsx,
// `repeat(auto-fill, minmax(260px,1fr))`), not the earlier horizontal thumb+text row. Long-press
// replaces the web's oncontextmenu-on-[data-author] handler — same 4 actions (filter/mute/
// highlight/favorite), computed here per-post instead of via a document-level contextmenu delegate.
export function PostCard({
    post, appid, prefs, apiHost, width,
    onToggleFilter, onToggleMute, onToggleHighlight, onToggleFavorite,
}: {
    post:    RedditPost
    appid:   number
    prefs:   LoadedPrefs
    apiHost: string | undefined
    // Fixed card width for the grid column (undefined = full-width single column).
    width?:  number
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
            style={[
                styles.card,
                width != null && { width },
                isHighlighted && styles.cardHighlighted,
                isFavorited && styles.cardFavorited,
                (isFiltered || isMuted) && styles.cardDimmed,
            ]}
            onPress={() => router.push(`/community/${appid}/thread/${post.id}?sub=${encodeURIComponent(post.subreddit ?? '')}` as never)}
            onLongPress={openMenu}
        >
            {thumb && (
                <View style={styles.imgWrap}>
                    <Image source={{ uri: thumb }} style={styles.img} contentFit="cover" />
                    {post.isVideo && (
                        <View style={styles.playOverlay} pointerEvents="none"><Text style={styles.playIcon}>▶</Text></View>
                    )}
                    {post.isGallery && (post.galleryImages?.length ?? 0) > 1 && (
                        <Text style={styles.galleryBadge}>⊞ {post.galleryImages?.length}</Text>
                    )}
                </View>
            )}
            <View style={styles.content}>
                <Text style={styles.title} numberOfLines={3}>{post.title}</Text>
                {!!post.selftext && <Text style={styles.body} numberOfLines={3}>{post.selftext}</Text>}
                <View style={styles.meta}>
                    <Text style={styles.score}>▲ {fmtScore(post.score)}</Text>
                    <View style={styles.metaIconText}>
                        <Lucide name="message-circle" color={colors.sky} size={14} />
                        <Text style={styles.metaText}>{(post.numComments ?? 0).toLocaleString()}</Text>
                    </View>
                    <Text style={[styles.metaText, isFavorited && styles.metaFavorited]} numberOfLines={1}>u/{author}</Text>
                    <Text style={styles.metaSub} numberOfLines={1}>r/{post.subreddit ?? ''}</Text>
                    <Text style={styles.metaText}>{fmtTime(post.createdUtc)}</Text>
                    {!!post.flair && <Text style={styles.flair} numberOfLines={1}>{post.flair}</Text>}
                </View>
            </View>
        </Pressable>
    )
}

const ACCENT = '#5b9bd5' // --community-accent

const styles = StyleSheet.create({
    // `.community-post-card`: vertical, bg-raised, bordered, rounded, image-clipping card.
    card: {
        flexDirection: 'column',
        backgroundColor: colors.bgRaised,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius,
        overflow: 'hidden',
    },
    cardDimmed:      { opacity: 0.2 },
    // Highlighted (per-game, teal) / favorited (global, amber) — border + faint bg tint, ported from
    // `.is-user-highlighted` / `.is-user-favorited`.
    cardHighlighted: { borderColor: 'rgba(52, 211, 190, 0.65)', backgroundColor: 'rgba(52, 211, 190, 0.05)' },
    cardFavorited:   { borderColor: 'rgba(251, 191, 36, 0.65)', backgroundColor: 'rgba(251, 191, 36, 0.05)' },
    // `.community-post-img` — full-width 180px cover image on top.
    imgWrap: { width: '100%', height: 180, backgroundColor: colors.bg },
    img: { width: '100%', height: '100%' },
    playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    playIcon: { color: '#fff', fontSize: 28, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 6 },
    galleryBadge: {
        position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)',
        color: '#fff', fontSize: 11, fontFamily: fonts.uiBold, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 12,
    },
    // `.community-post-content` — padded body below the image.
    content: { flex: 1, minWidth: 0, gap: 6, padding: 14 },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 15, lineHeight: 21 },
    body: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20 },
    // `.community-post-meta` — bottom-anchored wrapped meta row.
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 8 },
    score: { color: ACCENT, fontFamily: fonts.uiBold, fontSize: 12 },
    metaText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    metaIconText: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaFavorited: { color: colors.accent, fontFamily: fonts.uiBold },
    metaSub: { color: ACCENT, fontFamily: fonts.ui, fontSize: 12 },
    flair: {
        color: ACCENT, fontFamily: fonts.uiBold, fontSize: 11,
        backgroundColor: 'rgba(91, 155, 213, 0.12)', borderWidth: 1, borderColor: 'rgba(91, 155, 213, 0.32)',
        paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99,
    },
})
