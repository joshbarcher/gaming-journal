import { Image } from 'expo-image'
import type { ReactNode } from 'react'
import { GestureResponderEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import {
    RenderHTMLConfigProvider, RenderHTMLSource, TRenderEngineProvider,
} from 'react-native-render-html'
import Svg, { Path } from 'react-native-svg'

import { colors, fonts, radius, spacing } from '@/theme/tokens'

// The web guide pin marker is an inlined lucide "Pin" SVG (GuideViewer.svelte's PIN_SVG), NOT an
// emoji — replicated here via react-native-svg so native matches (no 📌 emoji).
function PinIcon({ size = 13, color = colors.accent }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M12 17v5" />
            <Path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
        </Svg>
    )
}

// Port of GuideBlockRenderer.svelte — renders a parsed guide's ContentBlock[] tree. Read the real
// source directly (not just the guides-architecture memory, which omits the exact `heading`/`list`
// shapes) and confirmed every block shape against REAL parsed guide data (Persona 3 Reload's real
// downloaded guides) before writing types: `paragraph`/list-item-text/table-cell all carry inline
// HTML (`<a href="slug">`, `<strong>`) that needs real rendering, not just stripping — this is the
// reason ContentBlockRenderer wraps react-native-render-html rather than plain <Text>.
//
// Wrapped once in <TRenderEngineProvider>/<RenderHTMLConfigProvider> and rendered per-snippet via
// <RenderHTMLSource> rather than one <RenderHTML> per block — the library's own docs recommend
// this for apps with many HTML instances per screen (a guide page can have dozens of paragraphs),
// sharing one render engine instead of re-creating it per block.
export interface ListItem {
    text: string
    children?: { ordered: boolean; items: ListItem[] }
}
export interface TableCell {
    text: string
    html?: string
    // An image living inside the cell. Same shape as an `image` block and resolved
    // through the same localSrc → imgUrl path; cells are otherwise text-only, so
    // without this the image is lost and only its alt text survives.
    image?: { localSrc?: string | null; src?: string; alt?: string }
    colspan?: number
    rowspan?: number
}
export type ContentBlock =
    | { type: 'section'; level: number; heading: string; id: string; children?: ContentBlock[] }
    | { type: 'heading'; level: number; text: string }
    | { type: 'paragraph'; html: string }
    | { type: 'list'; ordered?: boolean; variant?: 'jumplinks'; items: ListItem[] }
    | { type: 'image'; localSrc?: string | null; src?: string; alt?: string; caption?: string }
    | { type: 'table'; caption?: string; headers?: (TableCell | null)[]; rows: (TableCell | null)[][] }

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// RN-native equivalent of extractLabel() — the web inspects the clicked DOM element (figure/tr/
// p/li/heading) to pull a text snippet; RN has structured ContentBlock data instead, which is a
// more reliable source for the same snippet (no DOM-shape guessing needed).
function blockLabel(block: ContentBlock): string {
    const raw = (() => {
        switch (block.type) {
            case 'section': return block.heading
            case 'heading': return block.text
            case 'paragraph': return stripHtml(block.html)
            case 'list':
                if (block.variant === 'jumplinks') return 'Jump links'
                return block.items[0] ? `List: ${stripHtml(block.items[0].text)}` : 'List'
            case 'image': return block.caption || block.alt || 'Image'
            case 'table': return block.caption || 'Table'
        }
    })()
    return raw.length > 70 ? raw.slice(0, 70) + '…' : raw || 'Pin'
}

function pathsEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i])
}

export function ContentBlockRenderer({
    blocks, imgUrl, onImagePress, onLinkPress, onSectionRef, onBlockRef, onBlockOffset, onBlockLongPress, onPinPress, pinnedPath, contentWidth,
}: {
    blocks: ContentBlock[]
    // Precomputed by the caller (needs steamId/source/guideId/section — the Guide Viewer, a later
    // TODO item — this component stays decoupled from that addressing scheme).
    imgUrl: (localSrc: string) => string
    onImagePress: (url: string) => void
    onLinkPress?: (href: string) => void
    // Guide Viewer item: `section` blocks carry the real anchor `id` a same-page `href="#id"` link
    // targets (the web resolves these via `document.getElementById`, which RN has no equivalent
    // for) — the caller registers a ref per id here, then uses `measureLayout` against its own
    // ScrollView ref to compute a scroll offset, mirroring the web's `getBoundingClientRect()` delta
    // approach with RN's own layout-measurement primitive instead of a DOM query.
    onSectionRef?: (id: string, node: View | null) => void
    // Guide Pins item: registers a ref per block **index path** (not just `section` ids) — every
    // top-level block, and every block one level inside a `section`'s children (matching the real
    // web's own granularity: "a direct child of `.gv-content-inner`, or a direct child of a
    // `.gv-section` div" — confirmed via pins.md, not assumed deeper). Used the same way as
    // `onSectionRef`: the caller resolves a saved pin's `blockPath` to a live node via
    // `measureLayout` for auto-scroll.
    onBlockRef?: (path: number[], node: View | null) => void
    // Reports each block's onLayout y RELATIVE TO ITS PARENT, keyed by index path. The caller sums a
    // path's prefixes to get the absolute scroll offset — a deterministic alternative to measureLayout
    // (whose getInnerViewNode() target is unreliable under the New Architecture), so pin/search/anchor
    // scroll actually lands instead of silently no-op'ing.
    onBlockOffset?: (path: number[], y: number) => void
    // Long-press = the web's right-click ("Pin this location" / "Move pin here"). Fires with the
    // block's own index path, an RN-native label snippet (see `blockLabel()`), and the touch point so
    // the menu can anchor at the finger (like the game-card menu) instead of the screen centre.
    onBlockLongPress?: (path: number[], label: string, anchor?: { x: number; y: number }) => void
    // Tap the pin marker to remove the current page's pin (web parity — its marker is a delete button).
    onPinPress?: () => void
    // The current page's saved pin (if any) — highlights the matching block, mirroring `.gv-pinned`.
    pinnedPath?: number[] | null
    // Real warning caught during verification: react-native-render-html falls back to
    // Dimensions.window().width if this isn't provided, which "will become inconsistent after
    // screen rotations" per its own console warning. Defaults to the live window width here (this
    // component is rendered inside a full-width scroll container on every real call site so far);
    // callers with real side padding should pass the narrower measured value instead.
    contentWidth?: number
}) {
    const { width: windowWidth } = useWindowDimensions()
    const width = contentWidth ?? windowWidth
    return (
        <TRenderEngineProvider baseStyle={baseHtmlStyle} tagsStyles={tagsStyles} classesStyles={classesStyles}>
            <RenderHTMLConfigProvider renderersProps={{
                // **Real bug found during the Guide Viewer item's interactive verification**: the
                // library's own `ARenderer` passes a *normalized* href as the 2nd onPress arg (via
                // its `useNormalizedUrl` hook), which resolves bare relative slugs like
                // `"elizabeth-s-requests-guide"` against a synthetic `about://` base into
                // `"about://elizabeth-s-requests-guide"` — confirmed by reading `ARenderer.js`
                // directly after a real cross-page link click 404'd against that mangled path. The
                // 3rd callback arg is the tnode's raw `attributes` object (also passed by
                // `ARenderer.js`, `onPress(e, normalizedHref, tnode.attributes, target)`) — using
                // `attributes.href` instead recovers the exact original string the guide parser
                // wrote, with no resolution applied at all.
                a: { onPress: (_e, _normalizedHref, attributes) => onLinkPress?.(attributes.href) },
            }}>
                <Blocks
                    blocks={blocks} imgUrl={imgUrl} onImagePress={onImagePress} onLinkPress={onLinkPress} onSectionRef={onSectionRef}
                    onBlockRef={onBlockRef} onBlockOffset={onBlockOffset} onBlockLongPress={onBlockLongPress} onPinPress={onPinPress}
                    pinnedPath={pinnedPath ?? null} contentWidth={width} path={[]}
                />
            </RenderHTMLConfigProvider>
        </TRenderEngineProvider>
    )
}

function Blocks({ blocks, imgUrl, onImagePress, onLinkPress, onSectionRef, onBlockRef, onBlockOffset, onBlockLongPress, onPinPress, pinnedPath, contentWidth, path }: {
    blocks: ContentBlock[]
    imgUrl: (localSrc: string) => string
    onImagePress: (url: string) => void
    // Jump-link pills are Pressables, not <a> tags, so they can't go through the
    // RenderHTMLConfigProvider `a` handler — the callback has to reach them directly.
    onLinkPress?: (href: string) => void
    onSectionRef?: (id: string, node: View | null) => void
    onBlockRef?: (path: number[], node: View | null) => void
    onBlockOffset?: (path: number[], y: number) => void
    onBlockLongPress?: (path: number[], label: string, anchor?: { x: number; y: number }) => void
    onPinPress?: () => void
    pinnedPath: number[] | null
    contentWidth: number
    path: number[]
}) {
    return (
        <>
            {blocks.map((block, i) => {
                const myPath = [...path, i]
                const pinned = !!pinnedPath && pathsEqual(pinnedPath, myPath)
                // `key` belongs on the outermost element `.map()` actually returns — which is this
                // `PinnableBlock` wrapper, not the inner View/Text each branch builds. A real bug
                // caught during interactive verification: the key was originally placed on the
                // *inner* element instead, so React saw an unkeyed array of `PinnableBlock`s and
                // warned "Each child in a list should have a unique key prop" on every real page.
                const wrap = (node: ReactNode) => (
                    <PinnableBlock
                        key={i}
                        pinned={pinned}
                        onRef={onBlockRef ? (n) => onBlockRef(myPath, n) : undefined}
                        onOffset={onBlockOffset ? (y) => onBlockOffset(myPath, y) : undefined}
                        onLongPress={onBlockLongPress ? (e) => onBlockLongPress(myPath, blockLabel(block), { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }) : undefined}
                        onPinPress={pinned ? onPinPress : undefined}
                    >
                        {node}
                    </PinnableBlock>
                )

                if (block.type === 'section') {
                    return wrap(
                        <View style={styles.section} ref={onSectionRef ? (node) => onSectionRef(block.id, node) : undefined}>
                            <Heading level={block.level} text={block.heading} />
                            {!!block.children?.length && (
                                <Blocks blocks={block.children} imgUrl={imgUrl} onImagePress={onImagePress} onLinkPress={onLinkPress} onSectionRef={onSectionRef}
                                    onBlockRef={onBlockRef} onBlockOffset={onBlockOffset} onBlockLongPress={onBlockLongPress} onPinPress={onPinPress} pinnedPath={pinnedPath} contentWidth={contentWidth} path={myPath} />
                            )}
                        </View>,
                    )
                }
                if (block.type === 'heading') {
                    // level 1 is intentionally skipped, matching the web exactly (block.type ===
                    // 'heading' && block.level !== 1) — the guide's own <h1> is the page title,
                    // rendered separately by the caller, not part of the content stream.
                    if (block.level === 1) return null
                    return wrap(<Heading level={block.level} text={block.text} />)
                }
                if (block.type === 'paragraph') {
                    return wrap(
                        <View style={styles.paragraph}>
                            <RenderHTMLSource source={{ html: block.html }} contentWidth={contentWidth} />
                        </View>,
                    )
                }
                if (block.type === 'list') {
                    return block.variant === 'jumplinks'
                        ? wrap(<JumpLinksBlock items={block.items} onLinkPress={onLinkPress} />)
                        : wrap(<ListBlock ordered={!!block.ordered} items={block.items} contentWidth={contentWidth} />)
                }
                if (block.type === 'image') {
                    const url = block.localSrc ? imgUrl(block.localSrc) : (block.src ?? '')
                    if (!url) return null
                    return wrap(
                        <View style={styles.figure}>
                            <Pressable onPress={() => onImagePress(url)}>
                                <Image source={{ uri: url }} style={styles.image} contentFit="contain" />
                            </Pressable>
                            {!!block.caption && <Text style={styles.caption}>{block.caption}</Text>}
                        </View>,
                    )
                }
                if (block.type === 'table') {
                    return wrap(<TableBlock caption={block.caption} headers={block.headers} rows={block.rows}
                        contentWidth={contentWidth} imgUrl={imgUrl} onImagePress={onImagePress} />)
                }
                return null
            })}
        </>
    )
}

// Wraps a single block with pin support: a ref for scroll-to-pin resolution, long-press to
// pin/move-pin, and a highlight + delete marker when this block is the current page's saved pin.
// Kept as its own component (not inlined) so the `onLongPress` Pressable doesn't have to be
// duplicated across all 6 block-type branches above.
function PinnableBlock({ children, pinned, onRef, onOffset, onLongPress, onPinPress }: {
    children: ReactNode
    pinned: boolean
    onRef?: (node: View | null) => void
    onOffset?: (y: number) => void
    onLongPress?: (e: GestureResponderEvent) => void
    onPinPress?: () => void
}) {
    if (!onRef && !onLongPress && !onOffset) return <>{children}</>
    return (
        <Pressable
            ref={onRef as never}
            onLayout={onOffset ? (e) => onOffset(e.nativeEvent.layout.y) : undefined}
            onLongPress={onLongPress}
            style={pinned ? styles.pinnedBlock : undefined}
        >
            {pinned && (
                // web `.gv-pin-marker`: a lucide Pin button in the LEFT gutter (left:-22), tap to delete.
                <Pressable style={styles.pinMarker} onPress={onPinPress} hitSlop={12} accessibilityLabel="Remove pin">
                    <PinIcon />
                </Pressable>
            )}
            {children}
        </Pressable>
    )
}

function Heading({ level, text }: { level: number; text: string }) {
    const style = level === 2 ? styles.h2 : level === 3 ? styles.h3 : styles.h4
    return <Text style={style}>{text}</Text>
}

function ListItemRow({ item, ordered, num, contentWidth }: { item: ListItem; ordered: boolean; num: number; contentWidth: number }) {
    return (
        <View style={styles.listItem}>
            <Text style={styles.listMarker}>{ordered ? `${num}.` : '•'}</Text>
            <View style={styles.listItemBody}>
                <RenderHTMLSource source={{ html: item.text }} contentWidth={contentWidth} />
                {!!item.children?.items?.length && (
                    <View style={styles.nestedList}>
                        {item.children.items.map((child, i) => (
                            <ListItemRow key={i} item={child} ordered={item.children!.ordered} num={i + 1} contentWidth={contentWidth} />
                        ))}
                    </View>
                )}
            </View>
        </View>
    )
}

// An in-page TOC (list block with variant:'jumplinks'). Every item's text is exactly one
// `<a href="#fragment">Label</a>`, so the pills are built from a regex rather than routed
// through RenderHTMLSource — a wrapping row of Pressables can't be expressed as an HTML
// snippet, and each pill needs its own press target.
const JUMP_LINK = /^<a\s+href="(#[^"]+)"[^>]*>([\s\S]*)<\/a>$/i

const ENTITIES: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
}

function JumpLinksBlock({ items, onLinkPress }: { items: ListItem[]; onLinkPress?: (href: string) => void }) {
    const links = items.flatMap(item => {
        const match = item.text.trim().match(JUMP_LINK)
        if (!match) return []
        const label = stripHtml(match[2]).replace(/&[a-z]+;|&#\d+;/gi, e => ENTITIES[e.toLowerCase()] ?? e)
        return label ? [{ href: match[1], label }] : []
    })
    if (!links.length) return null

    return (
        <View style={styles.jumpLinks}>
            {links.map((link, i) => (
                <Pressable key={i} style={styles.jumpLink} onPress={() => onLinkPress?.(link.href)}>
                    <Text style={styles.jumpLinkText}>{link.label}</Text>
                </Pressable>
            ))}
        </View>
    )
}

function ListBlock({ ordered, items, contentWidth }: { ordered: boolean; items: ListItem[]; contentWidth: number }) {
    return (
        <View style={styles.list}>
            {items.map((item, i) => <ListItemRow key={i} item={item} ordered={ordered} num={i + 1} contentWidth={contentWidth} />)}
        </View>
    )
}

// Tables are structured JSON (headers/rows of cells), not raw HTML — rendered as a native grid
// rather than routed through react-native-render-html, which expects an HTML string to parse.
// Each cell's own text CAN contain inline HTML (`cell.html`), so cells still go through
// RenderHTMLSource individually.
function TableBlock({ caption, headers, rows, contentWidth, imgUrl, onImagePress }: {
    caption?: string; headers?: (TableCell | null)[]; rows: (TableCell | null)[][]; contentWidth: number
    imgUrl: (localSrc: string) => string; onImagePress: (url: string) => void
}) {
    const renderCell = (cell: TableCell) => {
        const url = cell.image?.localSrc ? imgUrl(cell.image.localSrc) : (cell.image?.src ?? '')
        if (!url) return <RenderHTMLSource source={{ html: cell.html ?? cell.text }} contentWidth={contentWidth} />
        return (
            <>
                <Pressable onPress={() => onImagePress(url)}>
                    <Image source={{ uri: url }} style={styles.tableCellImage} contentFit="contain" />
                </Pressable>
                {/* Cells can hold both an image and real content (item name, linked
                    location). Keep it, but skip when the text is just the image's alt. */}
                {!!(cell.html ?? cell.text) && cell.text !== cell.image?.alt && (
                    <RenderHTMLSource source={{ html: cell.html ?? cell.text }} contentWidth={contentWidth} />
                )}
            </>
        )
    }

    return (
        <View style={styles.tableWrap}>
            {!!caption && <Text style={styles.tableCaption}>{caption}</Text>}
            <View>
                {!!headers?.length && (
                    <View style={styles.tableRow}>
                        {headers.map((h, i) => h && (
                            <View key={i} style={[styles.tableCell, styles.tableHeaderCell]}>
                                {renderCell(h)}
                            </View>
                        ))}
                    </View>
                )}
                {rows.map((row, ri) => (
                    <View key={ri} style={styles.tableRow}>
                        {row.map((cell, ci) => cell && (
                            <View key={ci} style={styles.tableCell}>
                                {renderCell(cell)}
                            </View>
                        ))}
                    </View>
                ))}
            </View>
        </View>
    )
}

const baseHtmlStyle = { color: colors.text, fontFamily: fonts.ui, fontSize: 14, lineHeight: 21 }
const tagsStyles = {
    a: { color: colors.accent, textDecorationLine: 'underline' as const },
    strong: { fontFamily: fonts.uiBold },
    b: { fontFamily: fonts.uiBold },
    // Emphasis, not de-emphasis — mirrors guide-viewer.css.
    em: { color: colors.accent2 },
    i: { color: colors.accent2 },
}

// `.gv-keyword` wraps text the parser stripped an outbound anchor from. Styled as
// emphasis in the second accent, not as a link. Mirrors guide-viewer.css.
const classesStyles = {
    'gv-keyword': { color: colors.accent2 },
}

const styles = StyleSheet.create({
    section: { marginBottom: spacing.sm },
    paragraph: { marginBottom: spacing.sm },
    h2: { color: colors.text, fontFamily: fonts.title, fontSize: 20, marginTop: spacing.md, marginBottom: spacing.sm },
    h3: { color: colors.text, fontFamily: fonts.title, fontSize: 17, marginTop: spacing.md, marginBottom: spacing.xs },
    h4: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 15, marginTop: spacing.sm, marginBottom: spacing.xs },
    list: { marginBottom: spacing.sm, gap: 4 },
    listItem: { flexDirection: 'row', gap: spacing.xs },
    listMarker: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 14, width: 18 },
    listItemBody: { flex: 1 },
    nestedList: { marginTop: 4, marginLeft: spacing.sm, gap: 4 },
    jumpLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
    jumpLink: {
        paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999,
        borderWidth: 1, borderColor: 'rgba(201, 168, 76, 0.28)', backgroundColor: colors.accentBg,
    },
    jumpLinkText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17 },
    // Real bug caught during verification: `alignItems:'center'` here made this View's children
    // size-to-content instead of stretching to the parent's width — with the Image's own
    // `width:'100%'` then resolving against that undetermined size, both the wrapper and the
    // Image collapsed to 0×0 (confirmed via getBoundingClientRect: both reported `w:0,h:0`, even
    // though the underlying <img> had genuinely loaded, `naturalWidth:3840`/`complete:true` — the
    // image data was fine, only the layout was broken). Removed `alignItems:'center'` so the
    // default stretch behavior gives the Pressable/Image a real width to size against — matches
    // the web's own `<figure>` being a full-width block element anyway, not something narrower
    // and centered.
    figure: { marginBottom: spacing.sm },
    image: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius, backgroundColor: colors.bgHover },
    caption: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginTop: 4, textAlign: 'center' },
    tableWrap: { marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: 'hidden' },
    tableCaption: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, padding: spacing.xs, backgroundColor: colors.bgHover },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
    tableCell: { flex: 1, minWidth: 100, padding: spacing.xs, borderRightWidth: 1, borderRightColor: colors.border },
    tableHeaderCell: { backgroundColor: colors.bgHover },
    // Fills the cell's width; the fixed height keeps rows even across a table whose
    // screenshots vary in aspect ratio, and contentFit="contain" avoids cropping.
    tableCellImage: { width: '100%', height: 90, borderRadius: 4 },
    tableCellLabel: { color: colors.textMuted, fontSize: 11, marginTop: 4, textAlign: 'center' },
    // `.gv-pinned` — a subtle gold-tinted highlight; the marker itself is the lucide Pin (PinIcon),
    // positioned in the LEFT gutter (web `.gv-pin-marker { left: -22px }`), and is a tap-to-delete
    // button (web parity — its marker doubles as the remove control).
    pinnedBlock: { backgroundColor: 'rgba(201,168,76,0.06)', borderRadius: radius },
    pinMarker: { position: 'absolute', left: -22, top: 2, zIndex: 2, opacity: 0.85 },
})
