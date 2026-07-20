import { Image, type ImageLoadEventData } from 'expo-image'
import { useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import RenderHtml, {
    defaultSystemFonts, useContentWidth,
    type CustomBlockRenderer, type MixedStyleRecord,
} from 'react-native-render-html'

import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useSidebarStore } from '@/store/sidebarStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// web `.game-about-body { max-width: 860px }` — the About text + inline media live in one 860px
// reading column, NOT the full section width. Mirrored here so the Steam banner gifs/screenshots
// (natural width ~616px) sit in a tidy column instead of floating tiny in a full 1160dp tablet row.
const ABOUT_MAX = 860

// Rich HTML renderer shared by About, the News article reader, and PCGW notes/fixes — replaces the
// old `stripHtml()` plain-text simplification now that react-native-render-html is wired in. Styled
// to the dark theme's tokens; defensive against empty/undefined html (renders nothing). Exported
// from here (the canonical "render this description HTML" section) so the other owned sections reuse
// one style config rather than each re-declaring the tag map.
//
// The Steam "About This Game" HTML (and News bodies) carry INLINE MEDIA — <img> screenshots/gifs and
// occasional <video> — which the web renders inline (game.css `.game-about-body img/video`). The
// library's built-in <img> renderer uses React Native's core <Image>, which does NOT animate GIFs on
// Android; so we replace it with an expo-image renderer (animated-GIF + WebP capable, same component
// the rest of the app already uses for network images). <video> has no player dependency installed,
// so it degrades to its poster still-frame — the closest faithful representation of the web's inline
// video without pulling in a new native player module.
const SYSTEM_FONTS = [...defaultSystemFonts, fonts.ui, fonts.uiBold, fonts.title]

const baseStyle = { color: colors.text, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20 }

const tagsStyles: MixedStyleRecord = {
    p:          { marginTop: 0, marginBottom: spacing.sm },
    a:          { color: colors.accent, textDecorationLine: 'none' },
    strong:     { fontFamily: fonts.uiBold, color: colors.text },
    b:          { fontFamily: fonts.uiBold, color: colors.text },
    em:         { color: colors.accent2, fontStyle: 'italic' },
    i:          { fontStyle: 'italic' },
    u:          { textDecorationLine: 'underline' },
    s:          { textDecorationLine: 'line-through' },
    h1:         { fontFamily: fonts.title, color: colors.text, fontSize: 20, marginTop: spacing.sm, marginBottom: spacing.xs },
    h2:         { fontFamily: fonts.title, color: colors.text, fontSize: 17, marginTop: spacing.sm, marginBottom: spacing.xs },
    h3:         { fontFamily: fonts.title, color: colors.text, fontSize: 15, marginTop: spacing.sm, marginBottom: spacing.xs },
    h4:         { fontFamily: fonts.uiBold, color: colors.text, fontSize: 14, marginTop: spacing.xs, marginBottom: spacing.xs },
    ul:         { marginBottom: spacing.sm },
    ol:         { marginBottom: spacing.sm },
    li:         { color: colors.text, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20 },
    figure:     { marginTop: spacing.sm, marginBottom: spacing.sm, marginLeft: 0, marginRight: 0 },
    figcaption: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginTop: spacing.xs, textAlign: 'center' },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: spacing.sm, color: colors.textMuted, fontStyle: 'italic', marginBottom: spacing.sm },
    code:       { fontFamily: 'monospace', color: colors.accent2 },
    hr:         { marginTop: spacing.sm, marginBottom: spacing.sm },
}

// Steam CDN URLs are sometimes protocol-relative ("//cdn…") — expo-image needs an absolute scheme.
function normalizeUrl(src: string | undefined | null): string | null {
    if (!src) return null
    const s = src.trim()
    if (!s) return null
    if (s.startsWith('//')) return `https:${s}`
    return s
}

// One media primitive shared by the <img> and <video>-poster renderers. Mirrors game.css's
// `.game-about-body img { max-width:100%; width:auto; height:auto; margin:16px auto }`: the image is
// drawn at its NATURAL size, clamped to the text column width, and horizontally centred. Natural
// dimensions arrive from expo-image's onLoad (or the tag's own width/height attributes when Steam
// provides them, avoiding a layout shift). expo-image animates GIF/WebP, so Steam's inline gifs play.
function HtmlMedia({ uri, attrWidth, attrHeight, overlayPlay }: {
    uri: string
    attrWidth?: number
    attrHeight?: number
    overlayPlay?: boolean
}) {
    const contentWidth = useContentWidth()
    const [natW, setNatW] = useState<number | null>(attrWidth ?? null)
    const [ratio, setRatio] = useState<number>(attrWidth && attrHeight ? attrWidth / attrHeight : 16 / 9)

    const displayW = Math.min(natW ?? contentWidth, contentWidth)
    const displayH = displayW / ratio

    return (
        <View style={styles.mediaWrap}>
            <Image
                source={{ uri }}
                style={{ width: displayW, height: displayH, borderRadius: radius }}
                contentFit="contain"
                onLoad={(e: ImageLoadEventData) => {
                    const w = e.source?.width
                    const h = e.source?.height
                    if (w && h) { setNatW(w); setRatio(w / h) }
                }}
            />
            {overlayPlay && (
                <View style={styles.playOverlay} pointerEvents="none">
                    <View style={styles.playBadge}>
                        <Text style={styles.playGlyph}>▶</Text>
                    </View>
                </View>
            )}
        </View>
    )
}

// Replaces the library's built-in core-<Image> renderer so inline gifs/screenshots animate & load
// via expo-image (see file header). Renders nothing for a missing src rather than a broken box.
const ImgRenderer: CustomBlockRenderer = ({ tnode }) => {
    const uri = normalizeUrl(tnode.attributes.src)
    if (!uri) return null
    const w = Number(tnode.attributes.width) || undefined
    const h = Number(tnode.attributes.height) || undefined
    return <HtmlMedia uri={uri} attrWidth={w} attrHeight={h} />
}

// No video-player dependency is installed (expo-av / expo-video are both absent) and adding a native
// player is out of scope here — so an inline <video> degrades to its poster still-frame (expo-image)
// with a play glyph marking it as video content, rather than vanishing.
const VideoRenderer: CustomBlockRenderer = ({ tnode }) => {
    const poster = normalizeUrl(tnode.attributes.poster)
    if (!poster) return null
    return <HtmlMedia uri={poster} overlayPlay />
}

const renderers = { img: ImgRenderer, video: VideoRenderer }

export function RichHtml({ html, contentWidth }: { html: string | null | undefined; contentWidth?: number }) {
    const { width } = useWindowDimensions()
    if (!html || !html.trim()) return null
    return (
        <RenderHtml
            contentWidth={contentWidth ?? width - spacing.md * 2}
            source={{ html }}
            baseStyle={baseStyle}
            tagsStyles={tagsStyles}
            renderers={renderers}
            systemFonts={SYSTEM_FONTS}
            defaultTextProps={{ selectable: true }}
        />
    )
}

// Port of About.svelte — renders only if store.detailedDescription is truthy, matching the web
// exactly. Rich HTML (bold/lists/links + inline images/gifs/video posters) rendered via RichHtml,
// capped to the web's 860px `.game-about-body` reading column (rail-aware so it never exceeds the
// real tablet content width on narrower tiers).
export function About({ detailedDescription }: { detailedDescription: string | null | undefined }) {
    const { width } = useWindowDimensions()
    const breakpoint = useBreakpoint()
    const collapsed = useSidebarStore(s => s.collapsed)

    if (!detailedDescription) return null

    const isPermanentRail = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const rail = isPermanentRail ? (collapsed ? 68 : 280) : 0
    const bodyW = Math.min(Math.max(1, width - rail - spacing.md * 2), ABOUT_MAX)

    return (
        <View style={styles.section}>
            <Text style={styles.title}>About This Game</Text>
            <View style={{ maxWidth: ABOUT_MAX, width: '100%' }}>
                <RichHtml html={detailedDescription} contentWidth={bodyW} />
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    // Web centres inline media within the 860px text column (`margin: 16px auto`). Numeric image
    // widths (not '100%') keep alignItems:'center' safe here — the collapse-to-0 bug only bites when
    // a child is width:'100%' inside a size-to-content parent.
    mediaWrap: { alignItems: 'center', marginVertical: 16 },
    playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    playBadge: {
        width: 56, height: 56, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center', justifyContent: 'center',
    },
    playGlyph: { color: '#fff', fontSize: 24, marginLeft: 4 },
})
