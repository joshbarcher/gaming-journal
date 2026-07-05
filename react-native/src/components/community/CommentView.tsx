import { useVideoPlayer, VideoView } from 'expo-video'
import { useMemo, useState } from 'react'
import { Image } from 'expo-image'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { openScreenshotLightbox } from '@/store/screenshotLightboxStore'
import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtScore, fmtTime, resolveLocalOrUrl, resolveMediaUrl } from '@/utils/communityRender'
import type { RedditComment } from 'gaming-journal-contracts/reddit'

// Port of Comment.svelte — recursive, collapsed by default, same as the web. Image/gallery
// lightbox and imgur-album carousel are collapsed onto the already-existing
// ScreenshotLightboxHost (openScreenshotLightbox) instead of re-implementing the web's bespoke
// DOM-built lightbox/carousel modals — same end capability (tap an image, swipe through the
// album), one shared primitive instead of two new bespoke ones.
export function CommentView({ comment, apiHost, depth = 0 }: { comment: RedditComment; apiHost: string | undefined; depth?: number }) {
    const [collapsed, setCollapsed] = useState(true)
    const usedDepth = comment.depth ?? depth
    const author = comment.author ?? ''
    const replies = comment.replies ?? []

    const displayBody = useMemo(() => {
        const raw = comment.body ?? null
        if (!raw) return null
        return raw
            .replace(/https?:\/\/(?:preview|i)\.redd\.it\/\S+\.(?:png|jpe?g|gif|webp)\S*/gi, '')
            .replace(/!\[gif\]\(giphy\|[a-zA-Z0-9]+[^)]*\)/gi, '')
            .replace(/\[[^\]]*\]\(https?:\/\/(?:i\.)?imgur\.com\/[^)]+\)/gi, '')
            .replace(/https?:\/\/(?:i\.)?imgur\.com\/\S+/gi, '')
            .trim()
    }, [comment.body])

    const images = comment.images ?? []
    const gifs = (comment.gifs ?? []).filter(g => g.localVideo)
    const imgur = (comment.imgur ?? []).filter(e => e.images?.length && !e.failed)
    const hasBody = !!(displayBody || images.length || gifs.length || imgur.length)

    return (
        <View style={[styles.comment, usedDepth > 0 && styles.replyIndent]}>
            <View style={styles.header}>
                {replies.length > 0 && (
                    <Pressable onPress={() => setCollapsed(c => !c)} hitSlop={6}>
                        <Text style={styles.toggle}>{collapsed ? '+' : '−'}</Text>
                    </Pressable>
                )}
                <Text style={styles.author} numberOfLines={1}>{author || '[deleted]'}</Text>
                <Text style={styles.score}>▲ {fmtScore(comment.score)}</Text>
                <Text style={styles.time}>{fmtTime(comment.createdUtc)}</Text>
            </View>

            <View style={styles.body}>
                {displayBody ? (
                    <Text style={styles.bodyText}>{displayBody}</Text>
                ) : !hasBody ? (
                    <Text style={styles.deleted}>[deleted]</Text>
                ) : null}
            </View>

            {images.map((img, i) => {
                const srcs = images.map(im => resolveLocalOrUrl(im.localImage, im.url, apiHost)).filter((s): s is string => !!s)
                const src = resolveLocalOrUrl(img.localImage, img.url, apiHost)
                if (!src) return null
                return (
                    <Pressable key={i} style={styles.imageWrap} onPress={() => openScreenshotLightbox(srcs, i)}>
                        <Image source={{ uri: src }} style={styles.image} contentFit="cover" />
                    </Pressable>
                )
            })}

            {gifs.map((g, i) => {
                const uri = resolveMediaUrl(g.localVideo ? `/relay${g.localVideo}` : null, apiHost)
                return uri ? <CommentGif key={i} uri={uri} /> : null
            })}

            {imgur.map((entry, i) => {
                const srcs = entry.images.map(im => resolveLocalOrUrl(im.localImage, im.url, apiHost)).filter((s): s is string => !!s)
                if (!srcs.length) return null
                return (
                    <Pressable key={i} style={styles.imageWrap} onPress={() => openScreenshotLightbox(srcs, 0)}>
                        <Image source={{ uri: srcs[0] }} style={styles.image} contentFit="cover" />
                        {entry.images.length > 1 && (
                            <View style={styles.albumBadge}><Text style={styles.albumBadgeText}>+{entry.images.length - 1} more</Text></View>
                        )}
                    </Pressable>
                )
            })}

            {replies.length > 0 && !collapsed && (
                <View style={styles.replies}>
                    {replies.map((reply, i) => <CommentView key={reply.id ?? i} comment={reply} apiHost={apiHost} depth={usedDepth + 1} />)}
                </View>
            )}
        </View>
    )
}

function CommentGif({ uri }: { uri: string }) {
    const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = true; p.play() })
    return <VideoView player={player} style={styles.gif} contentFit="cover" nativeControls={false} />
}

const styles = StyleSheet.create({
    comment: { paddingVertical: spacing.sm },
    replyIndent: { marginLeft: spacing.md, paddingLeft: spacing.sm, borderLeftWidth: 1, borderLeftColor: colors.border },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 3 },
    toggle: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 13, width: 16, textAlign: 'center' },
    author: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12, flexShrink: 1 },
    score: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    time: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, opacity: 0.7 },
    body: {},
    bodyText: { color: colors.text, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
    deleted: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, fontStyle: 'italic' },
    imageWrap: { marginTop: spacing.xs, borderRadius: 4, overflow: 'hidden', maxWidth: 280 },
    image: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bgHover },
    gif: { width: '100%', maxWidth: 280, aspectRatio: 16 / 9, marginTop: spacing.xs, backgroundColor: colors.bgHover },
    albumBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
    albumBadgeText: { color: '#fff', fontSize: 9, fontFamily: fonts.ui },
    replies: { marginTop: spacing.xs },
})
